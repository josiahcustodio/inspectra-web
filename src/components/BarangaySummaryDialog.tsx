import { useMemo, useState } from "react";
import { Download, ExternalLink, FileText, LoaderCircle, Search, SlidersHorizontal, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { buildComplianceReportPdf, complianceReportFileName, type ComplianceReport } from "@/lib/complianceReportPdf";
import { logEvent } from "@/lib/auditEvents";
import { buildScopePreview, manilaDate, MAX_RANGE_DAYS, rangeInstants } from "@/lib/complianceReportScope";
import type { Establishment, InspectionLog } from "@/lib/models";
import { RATING_BANDS, ratingBandSpec, UNSCORED_COLOR } from "@/lib/ratingScale";
import { supabase } from "@/lib/supabase";

// [REF: AI_BARANGAY_SUMMARY] — client half.
//
// Pick a date range and barangays, see what that covers, then confirm. Only the
// confirm calls the generate-barangay-summary Edge Function (a paid API call).
// Its five-sentence summary is shown first as a preview; the PDF is built from
// the same response (src/lib/complianceReportPdf.ts) only when the user asks
// for the full report, so that step costs nothing.
//
// Edge Functions are served from the Supabase origin the CSP already allows,
// so this adds no new origin (see docs/SECURITY_HEADERS.md).

/** Starting range, in days. */
const DEFAULT_RANGE_DAYS = 90;
// shortcut: the table stops here to stay responsive, add paging if people need to read further.
const MAX_LISTED_ROWS = 300;

interface ReadyReport {
  url: string;
  fileName: string;
  size: number;
  pages: number;
}

interface Props {
  /** Undefined until the dashboard's first snapshot lands. */
  establishments: Establishment[] | undefined;
  logs: InspectionLog[] | undefined;
}

export function BarangaySummaryDialog({ establishments, logs }: Props) {
  const [open, setOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  // The function's response; previewed as a summary before any PDF exists.
  const [draft, setDraft] = useState<ComplianceReport | null>(null);
  const [report, setReport] = useState<ReadyReport | null>(null);
  const [isBuilding, setIsBuilding] = useState(false);
  const [editing, setEditing] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fromDay, setFromDay] = useState(() => manilaDate(new Date(Date.now() - DEFAULT_RANGE_DAYS * 24 * 60 * 60 * 1000)));
  const [toDay, setToDay] = useState(() => manilaDate(new Date()));
  // Tracks what's unticked, so a barangay that appears when the range widens starts ticked.
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(new Set());
  const [search, setSearch] = useState("");

  const range = useMemo(() => rangeInstants(fromDay, toDay), [fromDay, toDay]);
  const preview = useMemo(
    () => (range && logs && establishments ? buildScopePreview(logs, establishments, range, excluded) : null),
    [range, logs, establishments, excluded],
  );
  const visibleBarangays = preview?.barangays.filter((b) => b.name.toLowerCase().includes(search.trim().toLowerCase())) ?? [];

  const toggleBarangay = (name: string) => {
    const next = new Set(excluded);
    if (!next.delete(name)) next.add(name);
    setExcluded(next);
  };

  const generate = async () => {
    if (!range || !preview) return;
    setIsLoading(true);
    setError(null);
    const selected = preview.barangays.map((b) => b.name).filter((name) => !excluded.has(name));
    const { data, error: fnError } = await supabase.functions.invoke("generate-barangay-summary", {
      body: { ...range, barangays: selected.length < preview.barangays.length ? selected : undefined },
    });
    if (fnError) {
      // On a non-2xx the SDK gives a generic FunctionsHttpError; the function's
      // real message ("No inspections recorded...") is in the response body.
      let message = fnError.message;
      try {
        const body = await (fnError as { context?: Response }).context?.json();
        if (body?.error) message = body.error;
      } catch {
        // Body wasn't JSON (e.g. a gateway error page) — the generic message stands.
      }
      setError(message);
    } else {
      // Previous PDF is superseded; a tab already showing it keeps its copy.
      if (report) URL.revokeObjectURL(report.url);
      setReport(null);
      setDraft(data);
      setEditing(false);
      logEvent("REPORT", `Barangay compliance report ${fromDay} to ${toDay}` +
        (selected.length < preview.barangays.length ? `, ${selected.length} barangays` : ""));
    }
    setIsLoading(false);
  };

  const buildPdf = async () => {
    if (!draft) return;
    setIsBuilding(true);
    setError(null);
    try {
      const { blob, pages } = await buildComplianceReportPdf(draft);
      setReport({
        url: URL.createObjectURL(blob),
        fileName: complianceReportFileName(draft),
        size: blob.size,
        pages,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not build the PDF.");
    }
    setIsBuilding(false);
  };

  const canConfirm = !!preview && preview.inspections > 0 && !isLoading;

  return (
    <>
      <Button onClick={() => setOpen(true)} className="font-bold gap-2">
        <Sparkles className="w-4 h-4" />
        AI Compliance Summary
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="w-full sm:w-[80vw] sm:max-w-none h-[90vh] sm:h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-indigo-600" />
              Barangay Compliance Summary
            </DialogTitle>
            <DialogDescription>
              {editing
                ? "Choose what the report covers. Nothing is generated until you confirm."
                : report
                  ? "AI-drafted from the inspections you selected. Review before sharing — this is not an official record."
                  : "Preview of the AI-drafted summary. Create the full report when it looks right, or change the filters."}
            </DialogDescription>
          </DialogHeader>

          {isLoading && (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center">
              <LoaderCircle className="w-8 h-8 text-indigo-600 animate-spin" />
              <p className="text-sm text-muted-foreground font-bold">
                Analyzing inspections and drafting the report… this takes up to a minute.
              </p>
            </div>
          )}

          {!isLoading && editing && (
            <div className="flex-1 min-h-0 overflow-y-auto md:overflow-hidden grid grid-cols-1 md:grid-cols-[340px_1fr] gap-6">
              <div className="flex flex-col gap-4 md:min-h-0">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="report-from">From</Label>
                    <Input id="report-from" type="date" value={fromDay} max={toDay} onChange={(e) => setFromDay(e.target.value)} />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="report-to">To</Label>
                    <Input id="report-to" type="date" value={toDay} min={fromDay} onChange={(e) => setToDay(e.target.value)} />
                  </div>
                </div>

                <div className="flex flex-col gap-2 md:min-h-0 md:flex-1">
                  <div className="flex items-center justify-between">
                    <Label>Barangays</Label>
                    <div className="flex gap-3 text-emerald-700">
                      <button type="button" className="text-xs font-bold hover:underline" onClick={() => setExcluded(new Set())}>
                        Select all
                      </button>
                      <button type="button" className="text-xs font-bold hover:underline" onClick={() => setExcluded(new Set(preview?.barangays.map((b) => b.name)))}>
                        Clear
                      </button>
                    </div>
                  </div>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input aria-label="Search barangays" placeholder="Search barangays" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
                  </div>
                  <div className="max-h-56 md:max-h-none md:flex-1 md:min-h-0 overflow-y-auto rounded-lg border p-1">
                    {visibleBarangays.map((b) => (
                      <label key={b.name} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer hover:bg-slate-50">
                        <input type="checkbox" className="accent-emerald-600" checked={!excluded.has(b.name)} onChange={() => toggleBarangay(b.name)} />
                        <span className="flex-1 min-w-0 truncate text-slate-700" title={b.name}>{b.name}</span>
                        <span className="text-xs text-muted-foreground">{b.inspections}</span>
                      </label>
                    ))}
                    {visibleBarangays.length === 0 && (
                      <p className="p-3 text-center text-xs text-muted-foreground">
                        {preview && preview.barangays.length > 0 ? "No barangay matches your search." : "No barangays to show."}
                      </p>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-4 md:min-h-0">
                {!range && (
                  <p className="m-auto p-6 text-center text-sm font-bold text-muted-foreground">
                    Choose a valid date range of up to {MAX_RANGE_DAYS} days.
                  </p>
                )}
                {range && !preview && (
                  <div className="m-auto flex items-center gap-2 p-6 text-sm font-bold text-muted-foreground">
                    <LoaderCircle className="w-4 h-4 animate-spin" />
                    Loading inspections…
                  </div>
                )}
                {preview && (
                  <>
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                      {[
                        ["Establishments", preview.establishments],
                        ["Inspections", preview.inspections],
                        ["Barangays", preview.selectedBarangays],
                        ["Average rating", preview.averageRating === null ? "–" : `${preview.averageRating}%`],
                      ].map(([label, value]) => (
                        <div key={label} className="rounded-lg border bg-slate-50 p-3">
                          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-600">{label}</p>
                          <p className="text-2xl font-black text-slate-900">{value}</p>
                        </div>
                      ))}
                    </div>

                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-700">
                      {RATING_BANDS.map((b) => (
                        <span key={b.band} className="flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: b.color }} />
                          {b.label}: <strong>{preview.bands[b.band]}</strong>
                        </span>
                      ))}
                      {preview.unscored > 0 && <span className="text-muted-foreground">Not scored: {preview.unscored}</span>}
                    </div>

                    {preview.rows.length === 0 ? (
                      <p className="m-auto p-6 text-center text-sm font-bold text-muted-foreground">
                        No inspections match these filters.
                      </p>
                    ) : (
                      <div className="max-h-72 md:max-h-none md:flex-1 md:min-h-0 overflow-auto rounded-lg border">
                        <table className="w-full text-sm">
                          <thead className="sticky top-0 bg-slate-100 text-left text-xs font-bold text-slate-600">
                            <tr>
                              <th className="px-3 py-2">Establishment</th>
                              <th className="px-3 py-2">Barangay</th>
                              <th className="px-3 py-2 text-right">Inspections</th>
                              <th className="px-3 py-2">Lowest rating</th>
                            </tr>
                          </thead>
                          <tbody>
                            {preview.rows.slice(0, MAX_LISTED_ROWS).map((row) => (
                              <tr key={row.key} className="border-t text-slate-700">
                                <td className="px-3 py-2 font-semibold text-slate-900">{row.name}</td>
                                <td className="px-3 py-2">{row.barangay}</td>
                                <td className="px-3 py-2 text-right">{row.inspections}</td>
                                <td className="px-3 py-2 whitespace-nowrap">
                                  <span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ backgroundColor: row.lowest === null ? UNSCORED_COLOR : ratingBandSpec(row.lowest).color }} />
                                  {row.lowest === null ? "Not scored" : `${row.lowest}% ${ratingBandSpec(row.lowest).label}`}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {preview.rows.length > MAX_LISTED_ROWS && (
                          <p className="border-t p-2 text-center text-xs text-muted-foreground">
                            Showing the {MAX_LISTED_ROWS} lowest-rated of {preview.rows.length}. All of them are included in the report.
                          </p>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          )}

          {!isLoading && !editing && draft && (
            <div className="flex-1 min-h-0 overflow-y-auto">
              <div className="mx-auto flex max-w-2xl flex-col gap-4">
                {report && <div className="flex items-center gap-3 rounded-lg border bg-slate-50 p-3">
                  <FileText className="w-8 h-8 flex-shrink-0 text-emerald-700" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-slate-900">{report.fileName}</p>
                    <p className="text-xs text-muted-foreground">
                      PDF · {Math.max(1, Math.round(report.size / 1024))} KB · {report.pages} {report.pages === 1 ? "page" : "pages"}
                    </p>
                  </div>
                  <Button asChild variant="outline" size="sm" className="font-bold gap-2 flex-shrink-0">
                    <a href={report.url} download={report.fileName}>
                      <Download className="w-4 h-4" />
                      Download
                    </a>
                  </Button>
                </div>}

                <div>
                  <h3 className="mb-1 text-xs font-bold uppercase tracking-wider text-slate-600">{report ? "Summary" : "Summary preview"}</h3>
                  <p className="text-sm leading-relaxed text-slate-700">{draft.narrative.executive_summary}</p>
                </div>
              </div>
            </div>
          )}

          {!isLoading && editing && (
            <div className="flex-shrink-0 flex flex-wrap items-center justify-end gap-3">
              {error && <p role="alert" className="mr-auto text-sm font-bold text-red-600">{error}</p>}
              {draft && (
                <Button variant="outline" onClick={() => { setError(null); setEditing(false); }} className="font-bold">
                  Back to Report
                </Button>
              )}
              <Button onClick={generate} disabled={!canConfirm} className="font-bold gap-2">
                <Sparkles className="w-4 h-4" />
                Confirm &amp; Generate Report
              </Button>
            </div>
          )}

          {!isLoading && !editing && draft && (
            <div className="flex-shrink-0 flex flex-wrap items-center justify-end gap-2">
              {error && <p role="alert" className="mr-auto text-sm font-bold text-red-600">{error}</p>}
              <Button variant="outline" onClick={() => { setError(null); setEditing(true); }} className="font-bold gap-2">
                <SlidersHorizontal className="w-4 h-4" />
                Change Filters
              </Button>
              {report ? (
                <Button asChild className="font-bold gap-2">
                  <a href={report.url} target="_blank" rel="noopener">
                    <ExternalLink className="w-4 h-4" />
                    View Full Report
                  </a>
                </Button>
              ) : (
                <Button onClick={buildPdf} disabled={isBuilding} className="font-bold gap-2">
                  <FileText className="w-4 h-4" />
                  {isBuilding ? "Creating…" : "Create Full Report"}
                </Button>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
