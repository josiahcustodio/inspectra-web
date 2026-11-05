import { useState } from "react";
import { Download, ExternalLink, FileText, LoaderCircle, RefreshCw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { buildComplianceReportPdf, complianceReportFileName } from "@/lib/complianceReportPdf";
import { supabase } from "@/lib/supabase";

// [REF: AI_BARANGAY_SUMMARY] — client half.
//
// One button, one dialog: calls the generate-barangay-summary Edge Function
// (see supabase/functions/generate-barangay-summary/), builds the PDF from its
// response (src/lib/complianceReportPdf.ts) and offers it for download next to
// the five-sentence summary. The full report lives only in the PDF.
//
// Edge Functions are served from the Supabase origin the CSP already allows,
// so this adds no new origin (see docs/SECURITY_HEADERS.md).

/** Report window, in days. The server default is the same; sent explicitly so the UI copy can't drift from what was generated. */
const WINDOW_DAYS = 90;

interface ReadyReport {
  summary: string;
  url: string;
  fileName: string;
  size: number;
  pages: number;
}

export function BarangaySummaryDialog() {
  const [open, setOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [report, setReport] = useState<ReadyReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const generate = async () => {
    setIsLoading(true);
    setError(null);
    const { data, error: fnError } = await supabase.functions.invoke("generate-barangay-summary", {
      body: { days: WINDOW_DAYS },
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
      try {
        const { blob, pages } = await buildComplianceReportPdf(data);
        // Previous PDF is superseded; a tab already showing it keeps its copy.
        if (report) URL.revokeObjectURL(report.url);
        setReport({
          summary: data.narrative.executive_summary,
          url: URL.createObjectURL(blob),
          fileName: complianceReportFileName(data),
          size: blob.size,
          pages,
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not build the PDF.");
      }
    }
    setIsLoading(false);
  };

  // Generate on first open; after that the dialog reopens instantly with the
  // cached report (each generation is a paid API call) and offers Regenerate.
  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next && !report && !isLoading) generate();
  };

  return (
    <>
      <Button onClick={() => handleOpenChange(true)} className="font-bold gap-2">
        <Sparkles className="w-4 h-4" />
        AI Compliance Summary
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-indigo-600" />
              Barangay Compliance Summary
            </DialogTitle>
            <DialogDescription>
              AI-drafted from the last {WINDOW_DAYS} days of inspections. Review before sharing — this is not an official record.
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 min-h-0 overflow-y-auto">
            {isLoading && (
              <div className="flex flex-col items-center gap-3 py-16 text-center">
                <LoaderCircle className="w-8 h-8 text-indigo-600 animate-spin" />
                <p className="text-sm text-muted-foreground font-bold">
                  Analyzing inspections and drafting the report… this takes up to a minute.
                </p>
              </div>
            )}

            {!isLoading && error && (
              <div className="flex flex-col items-center gap-3 py-12 text-center">
                <p className="text-sm text-muted-foreground font-bold">{error}</p>
                <Button variant="outline" onClick={generate} className="font-bold">
                  Retry
                </Button>
              </div>
            )}

            {!isLoading && !error && report && (
              <div className="flex flex-col gap-4">
                <div className="flex items-center gap-3 rounded-lg border bg-slate-50 p-3">
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
                </div>

                <div>
                  <h3 className="mb-1 text-xs font-bold uppercase tracking-wider text-slate-600">Summary</h3>
                  <p className="text-sm leading-relaxed text-slate-700">{report.summary}</p>
                </div>
              </div>
            )}
          </div>

          {!isLoading && !error && report && (
            <div className="flex-shrink-0 flex justify-end gap-2">
              <Button variant="outline" onClick={generate} className="font-bold gap-2">
                <RefreshCw className="w-4 h-4" />
                Regenerate
              </Button>
              <Button asChild className="font-bold gap-2">
                <a href={report.url} target="_blank" rel="noopener">
                  <ExternalLink className="w-4 h-4" />
                  View Full Report
                </a>
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
