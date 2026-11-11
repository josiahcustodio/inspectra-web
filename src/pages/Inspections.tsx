import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { InspectionChecklistView } from "@/components/InspectionChecklistView";
import { PageStrip } from "@/components/PageStrip";
import { ClipboardCheck } from "lucide-react";
import { useMemo, useState } from "react";
import { useCollection } from "@/lib/useCollection";
import {
  COLLECTIONS,
  fetchInspectionDetails,
  mapEstablishment,
  mapInspectionLog,
} from "@/lib/dataAccess";
import type { InspectionLog } from "@/lib/models";
import { UNSCORED_LOG_LABEL, ratingColor, ratingLabel } from "@/lib/ratingScale";
import { byNewestFirst, isoDatePart, isoTimePart } from "@/lib/inspectionDates";
import { barangayOfEstablishment, canonicalBarangay } from "@/lib/barangayGeo";

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
  return UNSCORED_LOG_LABEL;
}

const PAGE_SIZE = 20;

interface InspectionRow extends InspectionLog {
  establishmentName: string;
  barangay: string | null;
  inspectorName: string;
  ratingBandLabel: string | null;
  score: number | null;
  status: string;
  date: string;
  time: string;
}

export function Inspections() {
  // [REF: INSPECTION_LIST]
  const { data: logs, error: loadError } = useCollection(COLLECTIONS.inspectionLogs, mapInspectionLog);
  const { data: establishments } = useCollection(COLLECTIONS.establishments, mapEstablishment);

  const inspections = useMemo(() => {
    if (!logs) return [];

    // Index the establishments once so resolving each log's display name is a
    // lookup instead of a scan. This used to be a per-row IndexedDB read; both
    // collections now arrive as whole live snapshots, so the join happens here.
    const nameById = new Map(
      (establishments ?? []).map((e) => [e.id, e.business_name] as const)
    );
    // Official spelling, the same resolution the dashboard and map use.
    const brgyById = new Map(
      (establishments ?? []).map((e) => [e.id, canonicalBarangay(barangayOfEstablishment(e))] as const)
    );

    const rows = logs.map((i): InspectionRow => ({
      ...i,
      establishmentName:
        (i.establishment_id ? nameById.get(i.establishment_id) : null) ||
        "Unknown Establishment",
      barangay: (i.establishment_id ? brgyById.get(i.establishment_id) : null) ?? null,
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

  // [REF: INSPECTION_FILTERS]
  // All client-side over the live snapshot, like the establishments list.
  // Dates compare on the calendar day the row already displays.
  const [search, setSearch] = useState("");
  const [barangayFilter, setBarangayFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const hasFilter = search !== "" || barangayFilter !== "all" || dateFrom !== "" || dateTo !== "";
  const clearFilters = () => {
    setSearch(""); setBarangayFilter("all"); setDateFrom(""); setDateTo(""); setPage(1);
  };

  const barangayOptions = useMemo(
    () => [...new Set(inspections.map((r) => r.barangay).filter((b): b is string => !!b))]
      .sort((a, b) => a.localeCompare(b, "en", { numeric: true })),
    [inspections],
  );

  const needle = search.trim().toLowerCase();
  const filtered = useMemo(
    () => inspections.filter((r) =>
      (barangayFilter === "all" || r.barangay === barangayFilter) &&
      (dateFrom === "" || r.date >= dateFrom) &&
      (dateTo === "" || r.date <= dateTo) &&
      (needle === "" ||
        r.establishmentName.toLowerCase().includes(needle) ||
        r.inspectorName.toLowerCase().includes(needle))),
    [inspections, barangayFilter, dateFrom, dateTo, needle],
  );

  // [REF: INSPECTION_PAGINATION]
  // Client-side pagination over the live snapshot: 20 records per page. The
  // page index is clamped rather than reset so a live update (a new record
  // arriving) doesn't yank the reader back to page 1.
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pagedInspections = filtered.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  );

  // [REF: INSPECTION_DETAILS_VIEW_WEB]
  // Clicking a record opens its full detail — fetched fresh from the database on
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

      {inspections.length > 0 && (
        <div className="flex items-center gap-3 flex-wrap">
          <input
            type="search"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search establishment or inspector…"
            className="w-full sm:w-72 text-sm font-medium border border-border rounded-lg px-3 py-2 bg-white text-slate-900"
          />
          <select
            aria-label="Filter by barangay"
            value={barangayFilter}
            onChange={(e) => { setBarangayFilter(e.target.value); setPage(1); }}
            className="text-sm font-medium border border-border rounded-lg px-3 py-2 bg-white text-slate-900 max-w-56"
          >
            <option value="all">All barangays</option>
            {barangayOptions.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
          <label className="flex items-center gap-2 text-sm font-medium text-slate-600">
            From
            <input type="date" value={dateFrom} max={dateTo || undefined} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
              className="text-sm font-medium border border-border rounded-lg px-3 py-2 bg-white text-slate-900" />
          </label>
          <label className="flex items-center gap-2 text-sm font-medium text-slate-600">
            To
            <input type="date" value={dateTo} min={dateFrom || undefined} onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
              className="text-sm font-medium border border-border rounded-lg px-3 py-2 bg-white text-slate-900" />
          </label>
          {hasFilter && (
            <button type="button" onClick={clearFilters} className="text-sm font-bold text-primary hover:underline">
              Clear
            </button>
          )}
          <span className="text-sm text-muted-foreground font-medium ml-auto tabular-nums">
            {filtered.length} inspection{filtered.length === 1 ? "" : "s"}
          </span>
        </div>
      )}

      {logs === undefined ? (
        <Card className="p-12 bg-white rounded-xl text-center">
          {loadError ? (
            <p className="text-sm text-red-700">Could not load inspections: {loadError.message}</p>
          ) : (
            <div className="w-8 h-8 mx-auto border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
          )}
        </Card>
      ) : inspections.length === 0 ? (
        <Card className="p-12 bg-white rounded-xl  text-center">
          <p className="text-muted-foreground font-bold">No inspections yet.</p>
          <p className="text-sm text-muted-foreground font-medium mt-1">Records appear here live as soon as field inspectors submit them.</p>
        </Card>
      ) : filtered.length === 0 ? (
        <Card className="p-12 bg-white rounded-xl text-center">
          <p className="text-muted-foreground font-bold">No inspections match these filters.</p>
          <button type="button" onClick={clearFilters} className="text-sm font-bold text-primary hover:underline mt-1">Clear filters</button>
        </Card>
      ) : (
        <Card className="overflow-hidden bg-white rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] border-border">
          <div className="overflow-x-auto">
            {/* table-fixed keeps every column at the same position on every page. */}
            <table className="w-full min-w-[60rem] table-fixed text-left border-collapse">
              <thead className="bg-white border-b border-border">
                <tr>
                  <th className="py-3 px-4 text-[10px] font-extrabold tracking-wider text-slate-500 uppercase">Establishment</th>
                  <th className="py-3 px-4 w-56 text-[10px] font-extrabold tracking-wider text-slate-500 uppercase">Rating</th>
                  <th className="py-3 px-4 w-32 text-[10px] font-extrabold tracking-wider text-slate-500 uppercase">Status</th>
                  <th className="py-3 px-4 w-48 text-[10px] font-extrabold tracking-wider text-slate-500 uppercase">Inspector</th>
                  <th className="py-3 px-4 w-32 text-[10px] font-extrabold tracking-wider text-slate-500 uppercase">Date</th>
                  <th className="py-3 px-4 w-24 text-[10px] font-extrabold tracking-wider text-slate-500 uppercase">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {pagedInspections.map((inspection) => (
                  // Same row pattern as the establishments table: no role="button",
                  // which would hide the row/cell semantics from screen readers.
                  <tr
                    key={inspection.id}
                    className="hover:bg-slate-50 transition-colors cursor-pointer"
                    tabIndex={0}
                    aria-haspopup="dialog"
                    onClick={() => openDetails(inspection)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        openDetails(inspection);
                      }
                    }}
                  >
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center flex-shrink-0">
                          <ClipboardCheck className="w-4 h-4 text-primary" />
                        </div>
                        <div className="min-w-0">
                          <span className="block font-bold text-slate-900 text-sm truncate" title={inspection.establishmentName}>
                            {inspection.establishmentName}
                          </span>
                          {inspection.barangay && (
                            <span className="block text-xs text-muted-foreground font-medium truncate">{inspection.barangay}</span>
                          )}
                        </div>
                        <span className="sr-only">— press Enter to view inspection details</span>
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      {inspection.ratingBandLabel ? (
                        <span
                          className="inline-flex items-center px-3 py-1 rounded-full text-xs font-bold border whitespace-nowrap"
                          style={{
                            backgroundColor: `color-mix(in srgb, ${ratingColor(inspection.score)} 15%, transparent)`,
                            color: ratingColor(inspection.score),
                            borderColor: `color-mix(in srgb, ${ratingColor(inspection.score)} 30%, transparent)`
                          }}
                        >
                          {/* One decimal at most: the score is a double and the column is fixed-width. */}
                          {inspection.ratingBandLabel} ({Number(inspection.score?.toFixed(1))}%)
                        </span>
                      ) : (
                        <span className="text-sm text-slate-400">—</span>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className="inline-flex items-center px-3 py-1 rounded-full text-xs font-bold border whitespace-nowrap"
                        style={{
                          backgroundColor: `color-mix(in srgb, ${getStatusColor(inspection.status)} 15%, transparent)`,
                          color: getStatusColor(inspection.status),
                          borderColor: `color-mix(in srgb, ${getStatusColor(inspection.status)} 30%, transparent)`
                        }}
                      >
                        {inspection.status}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-sm text-slate-700 font-medium truncate" title={inspection.inspectorName}>
                      {inspection.inspectorName}
                    </td>
                    <td className="py-3 px-4 text-sm text-slate-600 font-medium whitespace-nowrap tabular-nums">{inspection.date}</td>
                    <td className="py-3 px-4 text-sm text-slate-600 font-medium whitespace-nowrap tabular-nums">{inspection.time}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Pager */}
      {filtered.length > PAGE_SIZE && (
        <div className="flex items-center justify-between flex-wrap gap-3">
          <p className="text-sm text-muted-foreground font-medium">
            Showing {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, filtered.length)} of {filtered.length} inspections
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
