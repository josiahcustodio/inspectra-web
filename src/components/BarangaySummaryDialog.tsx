import { useState } from "react";
import { LoaderCircle, RefreshCw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/lib/supabase";

// [REF: AI_BARANGAY_SUMMARY] — client half.
//
// One button, one dialog: calls the generate-barangay-summary Edge Function
// (see supabase/functions/generate-barangay-summary/) and shows the plain-text
// report it returns. The function prompts the model to emit plain text with
// CAPS headings — not markdown — precisely so this component can render it in
// a whitespace-pre-wrap div and the app needs no markdown dependency.
//
// Edge Functions are served from the Supabase origin the CSP already allows,
// so this adds no new origin (see docs/SECURITY_HEADERS.md).

/** Report window, in days. The server default is the same; sent explicitly so the UI copy can't drift from what was generated. */
const WINDOW_DAYS = 90;

export function BarangaySummaryDialog() {
  const [open, setOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [report, setReport] = useState<string | null>(null);
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
      setReport(data.report);
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
        <DialogContent className="sm:max-w-3xl max-h-[85vh] flex flex-col">
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
              <p className="text-sm text-slate-700 bg-slate-50 rounded-lg p-4 whitespace-pre-wrap leading-relaxed">
                {report}
              </p>
            )}
          </div>

          {!isLoading && report && (
            <div className="flex-shrink-0 flex justify-end">
              <Button variant="outline" onClick={generate} className="font-bold gap-2">
                <RefreshCw className="w-4 h-4" />
                Regenerate
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
