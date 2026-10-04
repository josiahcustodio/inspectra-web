// [REF: MASTERLIST_IMPORT_PAGE]
//
// Admin-only. Walks one Excel masterlist through four stages:
//
//   pick file  ->  preview (choose which sheets to include)  ->  run  ->  report
//
// The heavy lifting lives in lib/import/ — parseWorkbook (Excel -> rows),
// matchRows (rows -> decisions), runImport (decisions -> Firestore). This
// page only sequences them and renders their results, so each stage can be
// read, and later tested, on its own.
//
// Categories are deliberately NOT part of this flow: an establishment gets
// its category from the checklist its inspections are scored against, after
// an inspection happens. What the masterlist itself classifies businesses by
// is its "Line/Kind of Business" column, which imports as a plain field.
//
// Everything runs in the browser as the signed-in admin. There is no server:
// if this tab closes mid-import the batch record stays status "running" with
// honest counters, and re-uploading the same file is safe — every write is a
// merge keyed on a stable id, so a re-run converges instead of duplicating.

import { useMemo, useRef, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileSpreadsheet, Upload } from "lucide-react";
import { firebaseDb } from "@/lib/firebase";
import { COLLECTIONS, mapEstablishment, mapReviewQueueItem } from "@/lib/firestore";
import { useCollection } from "@/lib/useCollection";
import { useAuth } from "@/lib/useAuth";
import type { Establishment, ReviewQueueItem } from "@/lib/models";
import { parseMasterlistWorkbook, type WorkbookParse } from "@/lib/import/parseWorkbook";
import {
  addToIndexes,
  buildMatchIndexes,
  decideRow,
  type ImportGroup,
  type MatchDecision,
} from "@/lib/import/matchRows";
import {
  applyReviewDecision,
  executeImport,
  type ImportResult,
} from "@/lib/import/runImport";

type Phase =
  | { step: "pick" }
  | { step: "preview"; fileName: string; parse: WorkbookParse }
  | { step: "running"; done: number; total: number }
  | { step: "done"; result: ImportResult; decisions: MatchDecision[]; parse: WorkbookParse }
  | { step: "failed"; message: string };

export function MasterlistImport() {
  const { user } = useAuth();

  const [group, setGroup] = useState<ImportGroup>("food");
  const [phase, setPhase] = useState<Phase>({ step: "pick" });
  // Sheets the admin unticked on the preview. Everything parseable is
  // included by default — skipping is the exception, not a setup chore.
  const [excludedSheets, setExcludedSheets] = useState<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Stage 1: parse the chosen file ────────────────────────────────────

  const handleFile = async (file: File) => {
    try {
      const parse = parseMasterlistWorkbook(await file.arrayBuffer());
      setExcludedSheets(new Set());
      setPhase({ step: "preview", fileName: file.name, parse });
    } catch (err) {
      setPhase({ step: "failed", message: `Couldn't read that file as an Excel workbook: ${err instanceof Error ? err.message : String(err)}` });
    }
  };

  // ── Stage 2+3: match every row, then write ────────────────────────────

  const handleRun = async (fileName: string, parse: WorkbookParse) => {
    if (!user) return;
    const importedSheets = parse.sheets.filter(
      (s) => s.rows.length > 0 && !excludedSheets.has(s.sheetName),
    );
    const totalRows = importedSheets.reduce((sum, s) => sum + s.rows.length, 0);
    setPhase({ step: "running", done: 0, total: totalRows });

    try {
      // One establishments fetch; the whole cascade then runs in memory.
      const snapshot = await getDocs(collection(firebaseDb, COLLECTIONS.establishments));
      const existing = snapshot.docs.map((d) => mapEstablishment(d.id, d.data()));
      const indexes = buildMatchIndexes(existing);

      const permitNosSeen = new Map<string, number>();
      const decisions: MatchDecision[] = [];
      for (const sheet of importedSheets) {
        for (const row of sheet.rows) {
          const decision = decideRow(row, group, indexes, permitNosSeen);
          if (decision.kind === "create") {
            // Pre-assign the id and index the new record immediately, so a
            // business appearing twice in this upload matches itself instead
            // of being created twice.
            decision.newId = crypto.randomUUID();
            addToIndexes(indexes, provisionalEstablishment(decision.newId, row.business_name, row.barangay, row.business_permit_no, row.tin, group, row.sheetName));
          }
          decisions.push(decision);
        }
      }

      const skippedRows = parse.sheets.reduce((sum, s) => sum + s.skipped.length, 0);
      const result = await executeImport({
        decisions,
        group,
        fileName,
        uploadedBy: user.uid,
        existing,
        skippedRows,
        onProgress: (done, total) => setPhase({ step: "running", done, total }),
      });

      setPhase({ step: "done", result, decisions, parse });
    } catch (err) {
      setPhase({
        step: "failed",
        message:
          err instanceof Error && err.message.includes("permission")
            ? "Firestore refused the import writes. The masterlist security rules may not be deployed yet — ask whoever manages firestore.rules."
            : `Import stopped: ${err instanceof Error ? err.message : String(err)}. Re-uploading the same file is safe — finished rows are simply confirmed again.`,
      });
    }
  };

  const reset = () => {
    setPhase({ step: "pick" });
    setExcludedSheets(new Set());
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full gap-6">
      <div className="flex-shrink-0">
        <h2 className="font-bold text-slate-900 text-2xl tracking-tight">Masterlist Import</h2>
        <p className="text-muted-foreground mt-1 text-sm font-medium">
          Upload the Excel masterlist from upper management. Inspection results are never touched by an import.
        </p>
      </div>

      {phase.step === "pick" && (
        <Card className="bg-white rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] border-border p-8 max-w-2xl">
          <div className="space-y-6">
            <div>
              <p className="font-bold text-slate-900 text-sm mb-2">Which masterlist is this?</p>
              {/* Chosen explicitly, never inferred from the filename — the real
                  food workbook contains a sheet literally named "NON FOOD". */}
              <div className="flex gap-3">
                {(["food", "non_food"] as const).map((g) => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => setGroup(g)}
                    className={`px-4 py-2 rounded-lg text-sm font-bold border transition-colors ${
                      group === g
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-white text-slate-600 border-border hover:bg-slate-50"
                    }`}
                  >
                    {g === "food" ? "Food" : "Non-Food"}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="font-bold text-slate-900 text-sm mb-2">Excel file</p>
              <label className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-border rounded-xl p-10 cursor-pointer hover:bg-slate-50 transition-colors">
                <Upload className="w-6 h-6 text-slate-400" />
                <span className="text-sm font-medium text-slate-600">Choose the .xlsx file</span>
                <span className="text-xs text-muted-foreground">Nothing is written until you confirm on the preview.</span>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void handleFile(file);
                  }}
                />
              </label>
            </div>
          </div>
        </Card>
      )}

      {phase.step === "preview" && (
        <PreviewStage
          parse={phase.parse}
          fileName={phase.fileName}
          group={group}
          excludedSheets={excludedSheets}
          setExcludedSheets={setExcludedSheets}
          onBack={reset}
          onRun={() => void handleRun(phase.fileName, phase.parse)}
        />
      )}

      {phase.step === "running" && (
        <Card className="bg-white rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] border-border p-8 max-w-2xl">
          <p className="font-bold text-slate-900">Importing… {phase.done} of {phase.total} rows</p>
          <div className="mt-4 h-2 rounded-full bg-slate-100 overflow-hidden">
            <div
              className="h-full bg-primary transition-all"
              style={{ width: phase.total === 0 ? "100%" : `${Math.round((phase.done / phase.total) * 100)}%` }}
            />
          </div>
          <p className="text-sm text-muted-foreground font-medium mt-3">
            Keep this tab open. If it closes, re-uploading the same file is safe.
          </p>
        </Card>
      )}

      {phase.step === "done" && <ReportStage result={phase.result} decisions={phase.decisions} parse={phase.parse} onReset={reset} />}

      {phase.step === "failed" && (
        <Card className="bg-white rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] border-border p-8 max-w-2xl">
          <p className="font-bold text-slate-900">Import didn't finish</p>
          <p className="text-sm text-muted-foreground font-medium mt-2">{phase.message}</p>
          <Button onClick={reset} className="mt-6 bg-primary hover:bg-primary/90 text-primary-foreground font-bold">
            Start over
          </Button>
        </Card>
      )}

      {(phase.step === "pick" || phase.step === "done") && <ReviewQueuePanel />}
    </div>
  );
}

// A stand-in Establishment for a row this import is about to create, carrying
// just the fields the match indexes read. No category — see the page header.
function provisionalEstablishment(
  id: string,
  businessName: string | null,
  barangay: string | null,
  permitNo: string | null,
  tin: string | null,
  group: ImportGroup,
  sheetName: string,
): Establishment {
  return {
    id,
    business_name: businessName ?? "",
    owner_name: null,
    address: null,
    barangay,
    qr_code_id: null,
    created_at: null,
    personnel_count: null,
    personnel_with_hc: null,
    sanitary_permit_no: null,
    control_no: null,
    category_id: null,
    category: null,
    business_permit_no: permitNo,
    tin,
    group,
    masterlist_sheet: sheetName,
    status: "active",
  };
}

// ─── Review queue ───────────────────────────────────────────────────────────

// [REF: MASTERLIST_REVIEW_QUEUE]
//
// The second half of the importer's "never auto-merge" promise. Rows whose
// match was ambiguous (similar name, or same TIN with a different name) were
// parked in review_queue instead of being imported; this panel is where an
// admin lands each one: merge it into the candidate it resembles, create it
// as a genuinely new business, or dismiss a bad row. Until a row is decided
// here, its data is NOT in the masterlist — which is why the panel sits on
// this page, impossible to miss on the next import.
function ReviewQueuePanel() {
  const { data } = useCollection(COLLECTIONS.reviewQueue, mapReviewQueueItem);
  const [busyId, setBusyId] = useState<string | null>(null);

  const pending = useMemo(
    () =>
      (data ?? [])
        .filter((item) => item.status === "pending")
        .sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [data],
  );

  if (pending.length === 0) return null;

  const decide = async (
    item: ReviewQueueItem,
    action: "merge" | "create" | "dismiss",
    targetEstablishmentId?: string,
  ) => {
    setBusyId(item.id);
    try {
      await applyReviewDecision({ item, action, targetEstablishmentId });
      toast.success(
        action === "merge" ? "Merged into the existing record."
        : action === "create" ? "Created as a new establishment."
        : "Dismissed.",
      );
    } catch {
      toast.error("Couldn't save that decision. Check your connection and try again.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Card className="bg-white rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] border-border">
      <div className="p-5 border-b border-border">
        <p className="font-bold text-slate-900">Needs your decision ({pending.length})</p>
        <p className="text-sm text-muted-foreground font-medium mt-1">
          These rows were close to an existing record, so the importer didn't guess.
          Until you decide, their data is not in the masterlist.
        </p>
      </div>
      <div className="divide-y divide-slate-100 max-h-[28rem] overflow-auto">
        {pending.map((item) => {
          const row = item.row as { business_name?: string; barangay?: string; business_permit_no?: string };
          const busy = busyId === item.id;
          return (
            <div key={item.id} className="p-5">
              <p className="text-sm">
                <span className="font-bold text-slate-900">{row.business_name ?? "(no name)"}</span>
                <span className="text-muted-foreground font-medium">
                  {" "}— {item.sheet_name} row {item.row_number}
                  {row.barangay ? `, ${row.barangay}` : ""}
                  {row.business_permit_no ? ` · ${row.business_permit_no}` : ""}
                </span>
              </p>
              <div className="mt-3 space-y-2">
                {item.candidates.map((c) => (
                  <div key={c.establishment_id} className="flex items-center justify-between gap-3 flex-wrap">
                    <p className="text-sm text-slate-600 font-medium">
                      {c.reason === "same-tin" ? "Same TIN as" : "Looks like"}{" "}
                      <span className="font-bold text-slate-900">{c.business_name}</span>
                      {" "}({Math.round(c.similarity * 100)}% name match)
                    </p>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => void decide(item, "merge", c.establishment_id)}
                      className="font-bold"
                    >
                      Same business — merge
                    </Button>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex gap-2">
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() => void decide(item, "create")}
                  className="bg-primary hover:bg-primary/90 text-primary-foreground font-bold"
                >
                  Different business — create new
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void decide(item, "dismiss")}
                  className="font-bold text-slate-500"
                >
                  Bad row — dismiss
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// ─── Preview stage ──────────────────────────────────────────────────────────

function PreviewStage(props: {
  parse: WorkbookParse;
  fileName: string;
  group: ImportGroup;
  excludedSheets: Set<string>;
  setExcludedSheets: (next: Set<string>) => void;
  onBack: () => void;
  onRun: () => void;
}) {
  const { parse, excludedSheets } = props;
  const importable = parse.sheets.filter((s) => s.rows.length > 0);
  const unrecognized = parse.sheets.filter((s) => s.layout === "unrecognized");
  const totalToImport = importable
    .filter((s) => !excludedSheets.has(s.sheetName))
    .reduce((sum, s) => sum + s.rows.length, 0);

  const toggleSheet = (sheetName: string, include: boolean) => {
    const next = new Set(excludedSheets);
    if (include) next.delete(sheetName);
    else next.add(sheetName);
    props.setExcludedSheets(next);
  };

  return (
    <Card className="flex-1 overflow-hidden flex flex-col bg-white rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] border-border">
      <div className="p-6 border-b border-border flex items-center justify-between flex-wrap gap-3">
        <div>
          <p className="font-bold text-slate-900 flex items-center gap-2">
            <FileSpreadsheet className="w-4 h-4 text-primary" /> {props.fileName}
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-slate-100 text-slate-700">
              {props.group === "food" ? "Food" : "Non-Food"}
            </span>
          </p>
          <p className="text-sm text-muted-foreground font-medium mt-1">
            {parse.sheets.length} sheets · {parse.totalRows} readable rows. Untick any sheet you don't want, then import.
          </p>
        </div>
        <div className="flex gap-3">
          <Button variant="outline" onClick={props.onBack} className="font-bold">Cancel</Button>
          <Button
            onClick={props.onRun}
            disabled={totalToImport === 0}
            className="bg-primary hover:bg-primary/90 text-primary-foreground font-bold"
          >
            Import {totalToImport} rows
          </Button>
        </div>
      </div>

      {unrecognized.length > 0 && (
        <div className="px-6 py-3 bg-amber-50 border-b border-amber-100 text-sm font-medium text-amber-800">
          {unrecognized.length} sheet{unrecognized.length > 1 ? "s" : ""} couldn't be read and will be skipped:{" "}
          {unrecognized.map((s) => s.sheetName).join(", ")}. {unrecognized[0].problem}
        </div>
      )}

      <div className="flex-1 overflow-auto min-h-0">
        <table className="w-full text-left border-collapse">
          <thead className="sticky top-0 bg-white z-10 shadow-sm border-b border-border">
            <tr>
              <th className="py-3 px-6 text-[10px] font-extrabold tracking-wider text-slate-500 uppercase">Include</th>
              <th className="py-3 px-6 text-[10px] font-extrabold tracking-wider text-slate-500 uppercase">Sheet</th>
              <th className="py-3 px-6 text-[10px] font-extrabold tracking-wider text-slate-500 uppercase">Layout</th>
              <th className="py-3 px-6 text-[10px] font-extrabold tracking-wider text-slate-500 uppercase text-right">Rows</th>
              <th className="py-3 px-6 text-[10px] font-extrabold tracking-wider text-slate-500 uppercase text-right">Set aside</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {importable.map((sheet) => {
              const included = !excludedSheets.has(sheet.sheetName);
              return (
                <tr key={sheet.sheetName} className="hover:bg-slate-50 transition-colors">
                  <td className="py-3 px-6">
                    <input
                      type="checkbox"
                      checked={included}
                      onChange={(e) => toggleSheet(sheet.sheetName, e.target.checked)}
                      aria-label={`Include sheet ${sheet.sheetName}`}
                    />
                  </td>
                  <td className={`py-3 px-6 font-bold text-sm ${included ? "text-slate-900" : "text-slate-400 line-through"}`}>
                    {sheet.sheetName}
                  </td>
                  <td className="py-3 px-6 text-sm text-slate-600 font-medium">
                    {sheet.layout === "header"
                      ? `Header on row ${sheet.headerRowNumber}`
                      : "No header (BPLO layout)"}
                  </td>
                  <td className="py-3 px-6 text-sm text-slate-600 font-medium text-right">{sheet.rows.length}</td>
                  <td className="py-3 px-6 text-sm text-slate-600 font-medium text-right">{sheet.skipped.length}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ─── Report stage ───────────────────────────────────────────────────────────

function ReportStage(props: {
  result: ImportResult;
  decisions: MatchDecision[];
  parse: WorkbookParse;
  onReset: () => void;
}) {
  const { result, decisions } = props;
  const reviews = decisions.filter((d) => d.kind === "review");
  const duplicates = decisions.filter((d) => d.kind === "duplicate-in-file");
  const skipped = props.parse.sheets.flatMap((s) =>
    s.skipped.map((row) => ({ sheetName: s.sheetName, ...row })),
  );

  const tiles: { label: string; value: number; tone: string }[] = [
    { label: "Permits updated", value: result.counters.updated, tone: "text-slate-900" },
    { label: "Renewals", value: result.counters.renewals, tone: "text-slate-900" },
    { label: "New establishments", value: result.counters.created, tone: "text-emerald-600" },
    { label: "Need review", value: result.counters.review, tone: result.counters.review > 0 ? "text-amber-600" : "text-slate-400" },
    { label: "Missing from file", value: result.missing.length, tone: result.missing.length > 0 ? "text-amber-600" : "text-slate-400" },
    { label: "Rows set aside", value: result.counters.skipped + result.counters.duplicates, tone: "text-slate-400" },
  ];

  return (
    <div className="flex flex-col gap-6 overflow-auto min-h-0">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {tiles.map((tile) => (
          <Card key={tile.label} className="bg-white rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] border-border p-4">
            <p className={`text-2xl font-extrabold tabular-nums ${tile.tone}`}>{tile.value}</p>
            <p className="text-xs font-bold text-slate-500 mt-1">{tile.label}</p>
          </Card>
        ))}
      </div>

      {reviews.length > 0 && (
        <ReportSection
          title={`Needs a human decision (${reviews.length})`}
          subtitle="Similar names found — these were NOT imported, so a wrong guess can't attach one business's history to another. Decide each one in the 'Needs your decision' panel below.">
          {reviews.map((d, i) =>
            d.kind === "review" ? (
              <div key={i} className="py-2 text-sm font-medium text-slate-700">
                <span className="font-bold">{d.row.business_name ?? "(no name)"}</span>
                <span className="text-muted-foreground"> — {d.row.sheetName} row {d.row.rowNumber}, looks like: </span>
                {d.candidates.map((c) => `${c.establishment.business_name} (${Math.round(c.similarity * 100)}%)`).join(", ")}
              </div>
            ) : null,
          )}
        </ReportSection>
      )}

      {result.missing.length > 0 && (
        <ReportSection
          title={`In the database but not in this file (${result.missing.length})`}
          subtitle="Possibly closed or renamed. Nothing was changed — if a business really is gone, use the Delist button on its row in the Masterlist page.">
          {result.missing.slice(0, 200).map((est) => (
            <div key={est.id} className="py-1.5 text-sm font-medium text-slate-700">
              <span className="font-bold">{est.business_name || "(unnamed)"}</span>
              <span className="text-muted-foreground"> — {est.line_of_business ?? "no line of business"}{est.barangay ? `, ${est.barangay}` : ""}</span>
            </div>
          ))}
          {result.missing.length > 200 && (
            <p className="py-2 text-sm text-muted-foreground font-medium">…and {result.missing.length - 200} more.</p>
          )}
        </ReportSection>
      )}

      {duplicates.length > 0 && (
        <ReportSection
          title={`Duplicate permit numbers inside the file (${duplicates.length})`}
          subtitle="The first occurrence was imported; these later rows were set aside.">
          {duplicates.map((d, i) =>
            d.kind === "duplicate-in-file" ? (
              <div key={i} className="py-1.5 text-sm font-medium text-slate-700">
                <span className="font-bold">{d.row.business_permit_no}</span>
                <span className="text-muted-foreground"> — {d.row.sheetName} row {d.row.rowNumber} repeats row {d.firstRowNumber}</span>
              </div>
            ) : null,
          )}
        </ReportSection>
      )}

      {skipped.length > 0 && (
        <ReportSection
          title={`Rows the parser set aside (${skipped.length})`}
          subtitle="Mostly blank spacers and title banners. Worth a skim — a real business in this list means the row needs fixing in Excel.">
          {skipped.slice(0, 100).map((s, i) => (
            <div key={i} className="py-1.5 text-sm font-medium text-slate-700">
              <span className="text-muted-foreground">{s.sheetName} row {s.rowNumber} ({s.reason}):</span> {s.preview || "(empty)"}
            </div>
          ))}
          {skipped.length > 100 && (
            <p className="py-2 text-sm text-muted-foreground font-medium">…and {skipped.length - 100} more.</p>
          )}
        </ReportSection>
      )}

      <div>
        <Button onClick={props.onReset} className="bg-primary hover:bg-primary/90 text-primary-foreground font-bold">
          Import another file
        </Button>
      </div>
    </div>
  );
}

function ReportSection(props: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <Card className="bg-white rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] border-border">
      <details>
        <summary className="p-5 cursor-pointer select-none">
          <span className="font-bold text-slate-900">{props.title}</span>
          <p className="text-sm text-muted-foreground font-medium mt-1">{props.subtitle}</p>
        </summary>
        <div className="px-5 pb-5 divide-y divide-slate-50 max-h-80 overflow-auto">{props.children}</div>
      </details>
    </Card>
  );
}
