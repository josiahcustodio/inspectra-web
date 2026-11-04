import { useMemo } from "react";
import { CheckCircle2, ImageOff, MinusCircle, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Establishment, InspectionLog } from "@/lib/models";
import { isoDatePart, isoTimePart } from "@/lib/inspectionDates";
import { SanitaryOrderView } from "@/components/SanitaryOrderView";

// [REF: INSPECTION_CHECKLIST_VIEW]
//
// The single renderer for one inspection's recorded detail: its fact strip,
// remarks, photo evidence and per-item checklist answers. The Inspections list
// dialog and the establishment history modal both mount this component, so the
// two views cannot drift apart the way duplicated copies of this logic have
// before.
//
// It owns the loading and error presentation too, because both callers fetch the
// log lazily through fetchInspectionDetails and need the same three states.

// The mobile client stores answers as 'Pass' / 'Fail' / 'NA'; logs from before
// that convention used 'Compliant' / 'Non-Compliant'. Normalise both.
type AnswerKind = "pass" | "fail" | "na";

// Exported for SanitaryOrderView, which derives the order's defect table from
// the same answers and must agree with this view about what a failure is.
export function answerKind(answer: unknown): AnswerKind {
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

interface InspectionChecklistViewProps {
  /** The freshly fetched log — null while it is in flight or nothing is selected. */
  log: InspectionLog | null;
  isLoading?: boolean;
  error?: string | null;
  /** Re-runs the fetch. Omit it and the error state shows no Retry button. */
  onRetry?: () => void;
  /** Passed through to the Sanitary Order, whose Name and Address lines come
   *  off the establishment rather than the log. Callers that do not have it
   *  (the Inspections list holds only log rows) may omit it; those lines then
   *  print blank, as an unfilled form would. */
  establishment?: Establishment | null;
}

export function InspectionChecklistView({
  log,
  isLoading,
  error,
  onRetry,
  establishment,
}: InspectionChecklistViewProps) {
  // Group the per-item answers under the sub-category their checklist template
  // assigned; items saved without one collect under "General".
  const groupedResults = useMemo(() => {
    const groups = new Map<string, any[]>();
    for (const result of log?.results ?? []) {
      const category = (result?.sub_category as string) || "General";
      const bucket = groups.get(category) ?? [];
      bucket.push(result);
      groups.set(category, bucket);
    }
    return groups;
  }, [log]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="w-8 h-8 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 py-12 text-center">
        <p className="text-muted-foreground font-bold">{error}</p>
        {onRetry && (
          <Button variant="outline" onClick={onRetry} className="font-bold">
            Retry
          </Button>
        )}
      </div>
    );
  }

  if (!log) return null;

  // [REF: INSPECTION_DATE_CONVENTION] sliced, not parsed — see inspectionDates.ts.
  const date = isoDatePart(log.inspection_date);
  const time = isoTimePart(log.inspection_date);

  return (
    <div className="space-y-5">
      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="p-3 rounded-lg bg-slate-50">
          <p className="text-xs text-muted-foreground font-bold mb-1">Inspector</p>
          <p className="text-sm font-bold text-slate-900 break-words">{log.inspector_name || "Unknown"}</p>
        </div>
        <div className="p-3 rounded-lg bg-slate-50">
          <p className="text-xs text-muted-foreground font-bold mb-1">Date</p>
          <p className="text-sm font-bold text-slate-900">
            {date}{time ? ` ${time}` : ""}
          </p>
        </div>
        <div className="p-3 rounded-lg bg-slate-50">
          <p className="text-xs text-muted-foreground font-bold mb-1">Rating</p>
          <p className="text-sm font-bold text-slate-900">
            {/* `== null` rather than `=== null`. The mapper now normalises a
                missing field to null, but the strict check that used to be here
                printed "undefined%" for a log saved without one, so the loose
                form stays as the guard for any log not built by the mapper.
                A missing score is not a zero, so it stays a dash. */}
            {log.percentage_rating == null ? "—" : `${log.percentage_rating}%`}
          </p>
        </div>
        <div className="p-3 rounded-lg bg-slate-50">
          <p className="text-xs text-muted-foreground font-bold mb-1">Total Demerits</p>
          <p className="text-sm font-bold text-slate-900">
            {/* Same trap as Rating above: the score is 100 minus the demerits, so
                printing "0" for a log that never recorded them asserts a spotless
                sheet and a perfect result. Absent stays absent. */}
            {log.total_demerits == null ? "—" : log.total_demerits}
          </p>
        </div>
      </div>

      {/* Sanitary Order, when this inspection issued one.
          Gated on `so_issued_at`, NOT on `so_no`: the number is typed off
          CHO's pre-numbered booklet and may legitimately be blank, so testing
          it would hide real orders. Placed above the remarks because it is the
          operative document — the rest of this view is the record behind it. */}
      {log.so_issued_at && (
        <SanitaryOrderView log={log} establishment={establishment} />
      )}

      {/* Remarks */}
      {log.remarks && (
        <div>
          <h4 className="font-bold text-slate-900 text-sm mb-2">Remarks</h4>
          <p className="text-sm text-slate-600 bg-slate-50 rounded-lg p-3 whitespace-pre-wrap">{log.remarks}</p>
        </div>
      )}

      {/* Photo evidence */}
      {log.photo_evidence_url && (
        <div>
          <h4 className="font-bold text-slate-900 text-sm mb-2">Photo Evidence</h4>
          <a href={log.photo_evidence_url} target="_blank" rel="noreferrer">
            <img
              src={log.photo_evidence_url}
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
          {log.results && log.results.length > 0 && (
            <span className="text-muted-foreground font-medium"> · {log.results.length} items</span>
          )}
        </h4>
        {!log.results || log.results.length === 0 ? (
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
                          {/* The item's extra inputs (label → value), written by the mobile
                              form for items whose template carries `fields`. Lists are
                              multi-selects; blanks were never filled and are skipped. */}
                          {Object.entries((item?.values ?? {}) as Record<string, unknown>)
                            .filter(([, v]) => (Array.isArray(v) ? v.length > 0 : String(v ?? "") !== ""))
                            .map(([k, v]) => (
                              <p key={k} className="text-xs text-slate-600 mt-0.5">
                                {k}: {Array.isArray(v) ? v.join(", ") : String(v)}
                              </p>
                            ))}
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
  );
}
