import { Card } from "../components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import { Button } from "../components/ui/button";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "../components/ui/pagination";
import {
  Calendar,
  CheckCircle2,
  ClipboardCheck,
  ImageOff,
  MinusCircle,
  User,
  XCircle,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useCollection } from "../../lib/useCollection";
import {
  COLLECTIONS,
  fetchInspectionDetails,
  mapEstablishment,
  mapInspectionLog,
} from "../../lib/firestore";
import type { InspectionLog } from "../../lib/models";

function getGradeColor(grade: string | null) {
  if (!grade) return "var(--muted-foreground)";
  switch (grade) {
    case "A":
      return "#10b981";
    case "B":
      return "#F59E0B";
    case "C":
    case "F":
      return "var(--destructive)";
    default:
      return "var(--muted-foreground)";
  }
}

function getStatusColor(status: string) {
  switch (status) {
    case "Completed":
      return "#10b981";
    case "Scheduled":
      return "#3b82f6";
    default:
      return "var(--muted-foreground)";
  }
}

function computeGrade(rating: number | null): string | null {
  if (rating === null) return null;
  if (rating >= 90) return "A";
  if (rating >= 80) return "B";
  if (rating >= 70) return "C";
  return "F";
}

function getStatus(rating: number | null): string {
  if (rating !== null) return "Completed";
  return "Scheduled";
}

const PAGE_SIZE = 20;

// Page-number strip: every page when there are few, otherwise first/last with
// a window around the current page and ellipses for the gaps.
function pageNumbers(current: number, total: number): (number | "…")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages: (number | "…")[] = [1];
  if (current > 3) pages.push("…");
  for (let p = Math.max(2, current - 1); p <= Math.min(total - 1, current + 1); p++) {
    pages.push(p);
  }
  if (current < total - 2) pages.push("…");
  pages.push(total);
  return pages;
}

// The mobile client stores answers as 'Pass' / 'Fail' / 'NA'; logs from before
// that convention used 'Compliant' / 'Non-Compliant'. Normalise both.
type AnswerKind = "pass" | "fail" | "na";

function answerKind(answer: unknown): AnswerKind {
  const a = String(answer ?? "").toLowerCase();
  if (a === "pass" || a === "compliant") return "pass";
  if (a === "fail" || a === "non-compliant") return "fail";
  return "na";
}

const ANSWER_STYLE: Record<AnswerKind, { label: string; color: string; Icon: typeof CheckCircle2 }> = {
  pass: { label: "Pass", color: "#10b981", Icon: CheckCircle2 },
  fail: { label: "Fail", color: "#EF4444", Icon: XCircle },
  na: { label: "N/A", color: "#64748b", Icon: MinusCircle },
};

interface InspectionRow extends InspectionLog {
  establishmentName: string;
  inspectorName: string;
  grade: string | null;
  score: number | null;
  status: string;
  date: string;
  time: string;
}

export function Inspections() {
  // [REF: INSPECTION_LIST]
  const { data: logs } = useCollection(COLLECTIONS.inspectionLogs, mapInspectionLog);
  const { data: establishments } = useCollection(COLLECTIONS.establishments, mapEstablishment);

  const inspections = useMemo(() => {
    if (!logs) return [];

    // Index the establishments once so resolving each log's display name is a
    // lookup instead of a scan. This used to be a per-row IndexedDB read; both
    // collections now arrive as whole live snapshots, so the join happens here.
    const nameById = new Map(
      (establishments ?? []).map((e) => [e.id, e.business_name] as const)
    );

    const rows = logs.map((i): InspectionRow => ({
      ...i,
      establishmentName:
        (i.establishment_id ? nameById.get(i.establishment_id) : null) ??
        "Unknown Establishment",
      inspectorName: i.inspector_name || "Unknown Inspector",
      grade: computeGrade(i.percentage_rating),
      score: i.percentage_rating,
      status: getStatus(i.percentage_rating),
      date: i.inspection_date ? i.inspection_date.split('T')[0] : "No Date",
      time: i.inspection_date && i.inspection_date.includes('T') ? i.inspection_date.split('T')[1].substring(0, 5) : "--:--"
    }));

    // Newest first. Dates are ISO-8601 strings, so plain string comparison
    // sorts chronologically; records with no date sink to the bottom.
    rows.sort((a, b) => {
      if (!a.inspection_date) return b.inspection_date ? 1 : 0;
      if (!b.inspection_date) return -1;
      return b.inspection_date.localeCompare(a.inspection_date);
    });
    return rows;
  }, [logs, establishments]);

  // [REF: INSPECTION_PAGINATION]
  // Client-side pagination over the live snapshot: 20 records per page. The
  // page index is clamped rather than reset so a live update (a new record
  // arriving) doesn't yank the reader back to page 1.
  const [page, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(inspections.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pagedInspections = inspections.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  );

  // [REF: INSPECTION_DETAILS_VIEW_WEB]
  // Clicking a record opens its full detail — fetched fresh from Firestore on
  // every open (with the legacy sub-collection fallback), not from the list
  // snapshot, so the dialog always shows what the database holds right now.
  const [selected, setSelected] = useState<InspectionRow | null>(null);
  const [detail, setDetail] = useState<InspectionLog | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [isDetailLoading, setIsDetailLoading] = useState(false);

  async function openDetails(inspection: InspectionRow) {
    setSelected(inspection);
    setDetail(null);
    setDetailError(null);
    setIsDetailLoading(true);
    try {
      setDetail(await fetchInspectionDetails(inspection.id));
    } catch (err: any) {
      setDetailError(err?.message || "Could not load inspection details.");
    } finally {
      setIsDetailLoading(false);
    }
  }

  const groupedResults = useMemo(() => {
    const groups = new Map<string, any[]>();
    for (const result of detail?.results ?? []) {
      const category = (result?.sub_category as string) || "General";
      const bucket = groups.get(category) ?? [];
      bucket.push(result);
      groups.set(category, bucket);
    }
    return groups;
  }, [detail]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-bold text-slate-900 text-2xl tracking-tight">Inspections</h2>
          <p className="text-muted-foreground mt-1">View and manage inspection records</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {inspections.length === 0 ? (
          <Card className="p-12 bg-white rounded-xl  text-center">
            <p className="text-muted-foreground font-bold">No inspections yet.</p>
            <p className="text-sm text-muted-foreground font-medium mt-1">Records appear here live as soon as field inspectors submit them.</p>
          </Card>
        ) : (
          pagedInspections.map((inspection) => (
            <Card
              key={inspection.id}
              className="p-6 bg-white rounded-xl  hover:shadow-md transition-shadow cursor-pointer"
              role="button"
              tabIndex={0}
              onClick={() => openDetails(inspection)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  openDetails(inspection);
                }
              }}
            >
              <div className="flex items-start justify-between">
                <div className="flex gap-4 flex-1">
                  <div className="w-12 h-12 rounded-full bg-slate-100  flex items-center justify-center flex-shrink-0">
                    <ClipboardCheck className="w-6 h-6 text-primary" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="font-bold text-slate-900 text-lg">{inspection.establishmentName}</h3>
                      {inspection.grade && (
                        <span
                          className="inline-flex items-center px-3 py-1 rounded-full text-xs font-bold border"
                          style={{
                            backgroundColor: `color-mix(in srgb, ${getGradeColor(inspection.grade)} 15%, transparent)`,
                            color: getGradeColor(inspection.grade),
                            borderColor: `color-mix(in srgb, ${getGradeColor(inspection.grade)} 30%, transparent)`
                          }}
                        >
                          Grade {inspection.grade} ({inspection.score})
                        </span>
                      )}
                      <span
                        className="inline-flex items-center px-3 py-1 rounded-full text-xs font-bold border"
                        style={{
                          backgroundColor: `color-mix(in srgb, ${getStatusColor(inspection.status)} 15%, transparent)`,
                          color: getStatusColor(inspection.status),
                          borderColor: `color-mix(in srgb, ${getStatusColor(inspection.status)} 30%, transparent)`
                        }}
                      >
                        {inspection.status}
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-x-6 gap-y-2 text-sm">
                      <div className="flex items-center gap-2 text-muted-foreground font-medium">
                        <User className="w-4 h-4" />
                        <span>{inspection.inspectorName}</span>
                      </div>
                      <div className="flex items-center gap-2 text-muted-foreground font-medium">
                        <Calendar className="w-4 h-4" />
                        <span>{inspection.date}</span>
                      </div>
                      <div className="flex items-center gap-2 text-muted-foreground font-medium">
                        <ClipboardCheck className="w-4 h-4" />
                        <span>{inspection.time}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </Card>
          ))
        )}
      </div>

      {/* Pager */}
      {inspections.length > PAGE_SIZE && (
        <div className="flex items-center justify-between flex-wrap gap-3">
          <p className="text-sm text-muted-foreground font-medium">
            Showing {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, inspections.length)} of {inspections.length} inspections
          </p>
          <Pagination className="mx-0 w-auto justify-end">
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious
                  href="#"
                  aria-disabled={currentPage === 1}
                  className={currentPage === 1 ? "pointer-events-none opacity-50" : ""}
                  onClick={(e) => { e.preventDefault(); setPage(currentPage - 1); }}
                />
              </PaginationItem>
              {pageNumbers(currentPage, pageCount).map((p, idx) => (
                <PaginationItem key={idx}>
                  {p === "…" ? (
                    <span className="px-2 text-muted-foreground">…</span>
                  ) : (
                    <PaginationLink
                      href="#"
                      isActive={p === currentPage}
                      onClick={(e) => { e.preventDefault(); setPage(p as number); }}
                    >
                      {p}
                    </PaginationLink>
                  )}
                </PaginationItem>
              ))}
              <PaginationItem>
                <PaginationNext
                  href="#"
                  aria-disabled={currentPage === pageCount}
                  className={currentPage === pageCount ? "pointer-events-none opacity-50" : ""}
                  onClick={(e) => { e.preventDefault(); setPage(currentPage + 1); }}
                />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        </div>
      )}

      {/* Inspection details */}
      <Dialog open={selected !== null} onOpenChange={(open) => { if (!open) setSelected(null); }}>
        <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-slate-900 font-bold flex items-center gap-3 flex-wrap pr-6">
              {selected?.establishmentName}
              {selected?.grade && (
                <span
                  className="inline-flex items-center px-3 py-1 rounded-full text-xs font-bold border"
                  style={{
                    backgroundColor: `color-mix(in srgb, ${getGradeColor(selected.grade)} 15%, transparent)`,
                    color: getGradeColor(selected.grade),
                    borderColor: `color-mix(in srgb, ${getGradeColor(selected.grade)} 30%, transparent)`
                  }}
                >
                  Grade {selected.grade} ({selected.score})
                </span>
              )}
            </DialogTitle>
          </DialogHeader>

          {isDetailLoading ? (
            <div className="flex items-center justify-center py-16">
              <div className="w-8 h-8 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
            </div>
          ) : detailError ? (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <p className="text-muted-foreground font-bold">{detailError}</p>
              <Button
                variant="outline"
                onClick={() => selected && openDetails(selected)}
                className="font-bold"
              >
                Retry
              </Button>
            </div>
          ) : detail ? (
            <div className="space-y-5">
              {/* Summary */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3 rounded-lg bg-slate-50">
                  <p className="text-xs text-muted-foreground font-bold mb-1">Inspector</p>
                  <p className="text-sm font-bold text-slate-900 break-words">{detail.inspector_name || "Unknown"}</p>
                </div>
                <div className="p-3 rounded-lg bg-slate-50">
                  <p className="text-xs text-muted-foreground font-bold mb-1">Date</p>
                  <p className="text-sm font-bold text-slate-900">
                    {selected?.date} {selected?.time !== "--:--" ? selected?.time : ""}
                  </p>
                </div>
                <div className="p-3 rounded-lg bg-slate-50">
                  <p className="text-xs text-muted-foreground font-bold mb-1">Rating</p>
                  <p className="text-sm font-bold text-slate-900">
                    {detail.percentage_rating !== null ? `${detail.percentage_rating}%` : "—"}
                  </p>
                </div>
                <div className="p-3 rounded-lg bg-slate-50">
                  <p className="text-xs text-muted-foreground font-bold mb-1">Total Demerits</p>
                  <p className="text-sm font-bold text-slate-900">{detail.total_demerits ?? 0}</p>
                </div>
              </div>

              {/* Remarks */}
              {detail.remarks && (
                <div>
                  <h4 className="font-bold text-slate-900 text-sm mb-2">Remarks</h4>
                  <p className="text-sm text-slate-600 bg-slate-50 rounded-lg p-3 whitespace-pre-wrap">{detail.remarks}</p>
                </div>
              )}

              {/* Photo evidence */}
              {detail.photo_evidence_url && (
                <div>
                  <h4 className="font-bold text-slate-900 text-sm mb-2">Photo Evidence</h4>
                  <a href={detail.photo_evidence_url} target="_blank" rel="noreferrer">
                    <img
                      src={detail.photo_evidence_url}
                      alt="Inspection evidence"
                      className="rounded-lg max-h-64 w-auto border border-border"
                    />
                  </a>
                </div>
              )}

              {/* Checklist results */}
              <div>
                <h4 className="font-bold text-slate-900 text-sm mb-2">
                  Checklist Results
                  {detail.results && detail.results.length > 0 && (
                    <span className="text-muted-foreground font-medium"> · {detail.results.length} items</span>
                  )}
                </h4>
                {!detail.results || detail.results.length === 0 ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground bg-slate-50 rounded-lg p-3">
                    <ImageOff className="w-4 h-4" />
                    No per-item answers were recorded for this inspection.
                  </div>
                ) : (
                  <div className="space-y-4">
                    {[...groupedResults.entries()].map(([category, items]) => (
                      <div key={category}>
                        <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-2">{category}</p>
                        <div className="space-y-1.5">
                          {items.map((item, idx) => {
                            const kind = answerKind(item?.answer);
                            const { label, color, Icon } = ANSWER_STYLE[kind];
                            return (
                              <div
                                key={item?.checklist_item_id ?? idx}
                                className="flex items-start gap-3 p-2.5 rounded-lg border border-border"
                              >
                                <Icon className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color }} />
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-medium text-slate-900">
                                    {item?.item_name ?? "Checklist item"}
                                  </p>
                                  {item?.note && (
                                    <p className="text-xs text-muted-foreground mt-0.5 whitespace-pre-wrap">{item.note}</p>
                                  )}
                                </div>
                                <span
                                  className="text-xs font-bold flex-shrink-0 px-2 py-0.5 rounded-full"
                                  style={{
                                    color,
                                    backgroundColor: `color-mix(in srgb, ${color} 12%, transparent)`,
                                  }}
                                >
                                  {label}
                                  {kind === "fail" && item?.weight ? ` · ${item.weight} demerit${item.weight === 1 ? "" : "s"}` : ""}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
