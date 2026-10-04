import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { InspectionChecklistView } from "@/components/InspectionChecklistView";
import { PageStrip } from "@/components/PageStrip";
import {
  Calendar,
  ClipboardCheck,
  User,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useCollection } from "@/lib/useCollection";
import {
  COLLECTIONS,
  fetchInspectionDetails,
  mapEstablishment,
  mapInspectionLog,
} from "@/lib/firestore";
import type { InspectionLog } from "@/lib/models";
import { ratingColor, ratingLabel } from "@/lib/ratingScale";
import { byNewestFirst, isoDatePart, isoTimePart } from "@/lib/inspectionDates";

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

function getStatus(rating: number | null | undefined): string {
  // `== null` rather than `=== null`. mapInspectionLog now normalises a missing
  // `percentage_rating` to null, so the strict form would also work — but this
  // guard is the last line of defence for a hand-built InspectionLog that never
  // went through the mapper, and five display bugs came from assuming otherwise.
  if (rating != null) return "Completed";
  return "Scheduled";
}

const PAGE_SIZE = 20;

interface InspectionRow extends InspectionLog {
  establishmentName: string;
  inspectorName: string;
  ratingBandLabel: string | null;
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
        (i.establishment_id ? nameById.get(i.establishment_id) : null) ||
        "Unknown Establishment",
      inspectorName: i.inspector_name || "Unknown Inspector",
      // [REF: RATING_SCALE] band label and colour both come from the shared scale.
      // `== null` catches undefined too — see getStatus above.
      ratingBandLabel: i.percentage_rating == null ? null : ratingLabel(i.percentage_rating),
      score: i.percentage_rating,
      status: getStatus(i.percentage_rating),
      // [REF: INSPECTION_DATE_CONVENTION] sliced, not parsed — see inspectionDates.ts.
      date: isoDatePart(i.inspection_date),
      time: isoTimePart(i.inspection_date) || "--:--"
    }));

    rows.sort(byNewestFirst);
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
                      {inspection.ratingBandLabel && (
                        <span
                          className="inline-flex items-center px-3 py-1 rounded-full text-xs font-bold border"
                          style={{
                            backgroundColor: `color-mix(in srgb, ${ratingColor(inspection.score)} 15%, transparent)`,
                            color: ratingColor(inspection.score),
                            borderColor: `color-mix(in srgb, ${ratingColor(inspection.score)} 30%, transparent)`
                          }}
                        >
                          {inspection.ratingBandLabel} ({inspection.score}%)
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
          <PageStrip
            current={currentPage}
            pageCount={pageCount}
            onPageChange={setPage}
            className="mx-0 w-auto justify-end"
          />
        </div>
      )}

      {/* Inspection details */}
      <Dialog open={selected !== null} onOpenChange={(open) => { if (!open) setSelected(null); }}>
        <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-slate-900 font-bold flex items-center gap-3 flex-wrap pr-6">
              {selected?.establishmentName}
              {selected?.ratingBandLabel && (
                <span
                  className="inline-flex items-center px-3 py-1 rounded-full text-xs font-bold border"
                  style={{
                    backgroundColor: `color-mix(in srgb, ${ratingColor(selected.score)} 15%, transparent)`,
                    color: ratingColor(selected.score),
                    borderColor: `color-mix(in srgb, ${ratingColor(selected.score)} 30%, transparent)`
                  }}
                >
                  {selected.ratingBandLabel} ({selected.score}%)
                </span>
              )}
            </DialogTitle>
          </DialogHeader>

          <InspectionChecklistView
            log={detail}
            isLoading={isDetailLoading}
            error={detailError}
            onRetry={() => selected && openDetails(selected)}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
