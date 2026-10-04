import { useEffect, useMemo, useState } from "react";
import { ClipboardCheck, User } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { InspectionChecklistView } from "./InspectionChecklistView";
import { PageStrip } from "./PageStrip";
import { useCollection } from "@/lib/useCollection";
import {
  COLLECTIONS,
  fetchInspectionDetails,
  mapInspectionLog,
} from "@/lib/firestore";
import type { Establishment, InspectionLog } from "@/lib/models";
import { ratingColor, ratingLabel } from "@/lib/ratingScale";
import { barangayOfEstablishment } from "@/lib/barangayGeo";
import {
  byNewestFirst,
  formatShortDate,
  relativeInspectionAge,
} from "@/lib/inspectionDates";

// Rows per page in the left pane. Small on purpose: at this size the pager is
// visible for almost any establishment with a history, which is the intended
// shape of the layout rather than an edge case. The inspections list keeps its
// own, much larger page size — the two lists genuinely differ, so this is not
// shared with src/lib/pagination.ts.
const HISTORY_PAGE_SIZE = 3;

interface HistoryRow {
  id: string;
  inspection_date: string | null;
  inspectorName: string;
  /** May be undefined as well as null — see the guard in the summary memo. */
  score: number | null | undefined;
}

interface EstablishmentHistoryModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The row that was clicked. Null keeps the dialog inert between openings. */
  establishment: Establishment | null;
}

// [REF: ESTABLISHMENT_HISTORY_MODAL]
//
// Master–detail view of one establishment's inspection record: its past
// inspections newest-first on the left, the selected one's full checklist on the
// right. The checklist half is InspectionChecklistView, the same component the
// Inspections page mounts, so there is exactly one renderer for it.
//
// The shell exists only to own the retry counter. A failed Firestore listener
// cannot be restarted in place, so Retry remounts the body by its key, which
// tears the dead subscription down and opens a fresh one.
export function EstablishmentHistoryModal({
  open,
  onOpenChange,
  establishment,
}: EstablishmentHistoryModalProps) {
  const [attempt, setAttempt] = useState(0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[900px] max-h-[85vh] flex flex-col overflow-hidden">
        <HistoryBody
          key={attempt}
          open={open}
          establishment={establishment}
          onRetry={() => setAttempt((a) => a + 1)}
        />
      </DialogContent>
    </Dialog>
  );
}

interface HistoryBodyProps extends Omit<EstablishmentHistoryModalProps, "onOpenChange"> {
  /** Remounts this component, which is what restarts a dead subscription. */
  onRetry: () => void;
}

function HistoryBody({ open, establishment, onRetry }: HistoryBodyProps) {
  // Latched, not gated on `open`: merely visiting the Establishments page should
  // not hold a live query over every inspection log, but dropping the
  // subscription on close would empty the panes mid-fade. So it opens on the
  // first view and stays open for the life of the page.
  const [hasOpened, setHasOpened] = useState(open);
  useEffect(() => {
    if (open) setHasOpened(true);
  }, [open]);

  // Filtered client-side off the live snapshot, the way Dashboard, GISMap and
  // Inspections all read this collection. A `where` query here would open a
  // second, differently-shaped subscription for the same documents.
  const { data: logs, error: logsError } = useCollection(
    COLLECTIONS.inspectionLogs,
    mapInspectionLog,
    hasOpened,
  );

  // `data` stays undefined until the first snapshot lands, which is the only way
  // to tell "still reading" from "genuinely empty" (see CollectionState.data).
  // Firestore runs on memoryLocalCache, so that first snapshot is always a
  // network round-trip — without this the modal claimed a clean record for an
  // establishment whose history simply had not arrived yet.
  const isHistoryLoading = !logsError && logs === undefined;

  const history = useMemo<HistoryRow[]>(() => {
    if (!establishment || !logs) return [];

    const rows = logs
      .filter((log) => log.establishment_id === establishment.id)
      .map((log): HistoryRow => ({
        id: log.id,
        inspection_date: log.inspection_date,
        inspectorName: log.inspector_name || "Unknown Inspector",
        score: log.percentage_rating,
      }));

    rows.sort(byNewestFirst);
    return rows;
  }, [logs, establishment]);

  // [REF: ESTABLISHMENT_HISTORY_SUMMARY]
  // Every figure here is measured off logs that actually exist, and the three
  // rating figures off the SCORED ones only.
  //
  // An unscored log is a real, expected state — the Inspections page renders
  // exactly those as "Scheduled" — so it must not speak for the establishment's
  // rating. Reading history[0] unconditionally meant a single unscored log made
  // an establishment with three passing inspections read "Not yet inspected",
  // which ratingScale.ts documents as meaning no inspection exists at all.
  //
  // Scores are gathered with `== null` so a score that is either null or
  // undefined is treated as absent, whatever built the log; and an absent score
  // is skipped, never counted as a zero, which would drag the average down and
  // assert a failing sanitary grade nobody recorded.
  const summary = useMemo(() => {
    const scored = history.filter(
      (h): h is HistoryRow & { score: number } => h.score != null,
    );
    // `history` is newest-first, so `scored` is too.
    const latest = scored[0] ?? null;
    const lastDated = scored.find((h) => h.inspection_date) ?? null;
    return {
      // All records, matching the left pane exactly — see the count tile.
      count: history.length,
      scoredCount: scored.length,
      // True only when the two populations genuinely differ, so the caption that
      // discloses it adds no noise to the common case (everything scored) or to
      // the all-unscored case (where every rating figure is plainly absent).
      showsScoredSubset: scored.length > 0 && scored.length < history.length,
      latestScore: latest?.score,
      average: scored.length > 0
        ? Math.round(scored.reduce((sum, h) => sum + h.score, 0) / scored.length)
        : null,
      lastInspected: lastDated?.inspection_date ? relativeInspectionAge(lastDated.inspection_date) : null,
    };
  }, [history]);

  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Reset on the way INTO open, never on close: clearing the selection as the
  // dialog starts fading out empties the right pane while it is still on screen,
  // so it visibly collapses. Keyed on the establishment id too, so opening a
  // different row does not inherit the previous one's selection.
  useEffect(() => {
    if (!open) return;
    setPage(1);
    setSelectedId(null);
  }, [establishment?.id, open]);

  // Auto-select the newest inspection so the detail pane is never empty for an
  // establishment that has any. Only fires while nothing is selected, so a live
  // snapshot arriving does not yank the reader off the row they picked.
  useEffect(() => {
    if (!open || selectedId !== null || history.length === 0) return;
    setSelectedId(history[0].id);
  }, [open, selectedId, history]);

  // Fetched fresh per selection (with the legacy sub-collection fallback) rather
  // than read off the list snapshot, so the checklist is what the database holds
  // right now. `retryToken` is what makes the error state's Retry re-run this.
  const [detail, setDetail] = useState<InspectionLog | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    setDetail(null);
    setDetailError(null);
    if (!selectedId) {
      setIsDetailLoading(false);
      return;
    }

    let cancelled = false;
    setIsDetailLoading(true);
    fetchInspectionDetails(selectedId)
      .then((log) => { if (!cancelled) setDetail(log); })
      .catch((err: any) => {
        if (!cancelled) setDetailError(err?.message || "Could not load inspection details.");
      })
      .finally(() => { if (!cancelled) setIsDetailLoading(false); });

    return () => { cancelled = true; };
  }, [selectedId, retryToken]);

  const pageCount = Math.max(1, Math.ceil(history.length / HISTORY_PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pagedHistory = history.slice(
    (currentPage - 1) * HISTORY_PAGE_SIZE,
    currentPage * HISTORY_PAGE_SIZE,
  );

  const barangay = establishment ? barangayOfEstablishment(establishment) : null;
  const subtitle = establishment
    ? [
        establishment.category || establishment.category_id,
        establishment.sanitary_permit_no ? `Permit ${establishment.sanitary_permit_no}` : null,
        barangay ? `Brgy. ${barangay}` : null,
      ].filter(Boolean).join(" · ")
    : "";

  return (
    <>
      <DialogHeader>
        <DialogTitle className="text-slate-900 font-bold pr-6">
          {establishment?.business_name || "Establishment"}
        </DialogTitle>
        <DialogDescription className="font-medium">
          {subtitle || "No category, permit number or barangay on record."}
        </DialogDescription>
      </DialogHeader>

      {logsError ? (
        // Same copy and structure the Establishments table uses for its own
        // failed collection, so the page reads consistently.
        <div className="p-12 text-center my-auto">
          <p className="text-muted-foreground font-bold">Couldn't load inspection history.</p>
          <p className="text-sm text-muted-foreground font-medium mt-1">
            Check your connection — this history is read live from the server.
          </p>
          <Button variant="outline" onClick={onRetry} className="font-bold mt-4">
            Retry
          </Button>
        </div>
      ) : isHistoryLoading ? (
        <div className="p-12 text-center my-auto">
          <div className="w-8 h-8 border-4 border-primary/30 border-t-primary rounded-full animate-spin mx-auto" />
          <p className="text-sm text-muted-foreground font-medium mt-4">
            Loading inspection history...
          </p>
        </div>
      ) : (
        <>
          {/* Summary strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 flex-shrink-0">
            <div className="p-3 rounded-lg bg-slate-50">
              {/* Every record for this establishment — exactly the rows the left
                  pane pages through, so the figure is verifiable by counting them.
                  Deliberately NOT the scored subset the three tiles beside it use. */}
              <p className="text-lg font-bold text-slate-900 leading-tight">{summary.count}</p>
              <p className="text-xs text-muted-foreground font-bold mt-0.5">
                Inspection{summary.count === 1 ? "" : "s"} on file
              </p>
            </div>
            <div className="p-3 rounded-lg bg-slate-50">
              {/* [REF: RATING_SCALE] band label and colour both come from the shared
                  scale, which returns the grey "Not yet inspected" treatment for a
                  missing score — so no threshold or hex is written here. */}
              <p
                className="text-lg font-bold leading-tight"
                style={{ color: ratingColor(summary.latestScore) }}
              >
                {summary.latestScore == null ? "—" : `${summary.latestScore}%`}
              </p>
              <p className="text-xs text-muted-foreground font-bold mt-0.5">
                {ratingLabel(summary.latestScore)}
              </p>
            </div>
            <div className="p-3 rounded-lg bg-slate-50">
              <p className="text-lg font-bold text-slate-900 leading-tight">
                {summary.average == null ? "—" : `${summary.average}%`}
              </p>
              {/* Where some records are unscored, this caption is what makes the
                  gap between the count tile and these three discoverable instead
                  of leaving a reader to wonder why 4 records average over 3. It
                  stays the plain label in the common case where all are scored,
                  and in the all-unscored case, where every figure here is simply
                  absent and says so. */}
              <p className="text-xs text-muted-foreground font-bold mt-0.5">
                {summary.showsScoredSubset
                  ? `Average of ${summary.scoredCount} scored`
                  : "Average score"}
              </p>
            </div>
            <div className="p-3 rounded-lg bg-slate-50">
              <p className="text-lg font-bold text-slate-900 leading-tight">
                {summary.lastInspected ?? "—"}
              </p>
              <p className="text-xs text-muted-foreground font-bold mt-0.5">Last inspected</p>
            </div>
          </div>

          {history.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-1 py-16 text-center flex-1">
              <ClipboardCheck className="w-8 h-8 text-muted-foreground mb-2" />
              <p className="text-muted-foreground font-bold">No inspections recorded yet.</p>
              <p className="text-sm text-muted-foreground font-medium">
                This establishment's history fills in here as soon as a field inspector submits one.
              </p>
            </div>
          ) : (
            // One column until there is room for two panes side by side; the dialog
            // caps at 900px, so lg is the point where both halves still read
            // comfortably. `items-start` keeps the short left pane at its natural
            // height instead of stretching it to match the much taller checklist,
            // and the right pane carries its own scrollbar so a long checklist
            // never drags the list of dates down with it.
            <div className="grid lg:grid-cols-[16rem_minmax(0,1fr)] lg:items-start gap-4 flex-1 min-h-0 overflow-y-auto">
              {/* Past inspections */}
              <div className="flex flex-col lg:border-r lg:border-border lg:pr-4">
                <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-2">
                  Past inspections
                </p>
                {/* A page of HISTORY_PAGE_SIZE rows always fits, so this list does
                    not scroll — paging is the only way through the history. */}
                <div className="space-y-1.5">
                  {pagedHistory.map((row) => {
                    const isSelected = row.id === selectedId;
                    return (
                      <button
                        key={row.id}
                        type="button"
                        aria-current={isSelected ? "true" : undefined}
                        onClick={() => setSelectedId(row.id)}
                        className={`w-full text-left p-2.5 rounded-lg border transition-colors ${
                          isSelected
                            ? "border-primary bg-secondary"
                            : "border-border hover:bg-slate-50"
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          {/* Fixed-width marker slot so the dates stay aligned whether
                              or not the row is the selected one. */}
                          <span className="w-1.5 flex-shrink-0">
                            {isSelected && <span className="block w-1.5 h-1.5 rounded-full bg-primary" />}
                          </span>
                          <span className="text-sm font-bold text-slate-900">
                            {/* [REF: INSPECTION_DATE_CONVENTION] the shared formatter,
                                so this pane and the checklist beside it cannot render
                                one inspection as two different days. */}
                            {formatShortDate(row.inspection_date)}
                          </span>
                          <span
                            className="ml-auto text-xs font-bold flex-shrink-0"
                            style={{ color: ratingColor(row.score) }}
                          >
                            {row.score == null ? "—" : `${row.score}%`}
                          </span>
                        </div>
                        <p
                          className="text-xs font-bold mt-1 pl-3.5"
                          style={{ color: ratingColor(row.score) }}
                        >
                          {ratingLabel(row.score)}
                        </p>
                        <p className="text-xs text-muted-foreground font-medium mt-0.5 pl-3.5 flex items-center gap-1.5">
                          <User className="w-3 h-3 flex-shrink-0" />
                          <span className="truncate">{row.inspectorName}</span>
                        </p>
                      </button>
                    );
                  })}
                </div>
                {history.length > HISTORY_PAGE_SIZE && (
                  <PageStrip
                    current={currentPage}
                    pageCount={pageCount}
                    onPageChange={setPage}
                    className="mx-0 w-auto justify-start mt-3"
                  />
                )}
              </div>

              {/* Checklist */}
              <div className="max-h-[58vh] overflow-y-auto min-h-0">
                <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-2">
                  Checklist
                </p>
                <InspectionChecklistView
                  // Guarded on the id so a detail left over from the previously
                  // selected row is never shown under this row's heading.
                  log={detail && detail.id === selectedId ? detail : null}
                  isLoading={isDetailLoading}
                  error={detailError}
                  onRetry={() => setRetryToken((t) => t + 1)}
                />
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}
