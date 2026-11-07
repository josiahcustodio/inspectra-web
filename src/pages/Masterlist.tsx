// [REF: MASTERLIST_GRID]
//
// Admin-only. The masterlist the way upper management knows it: one dense,
// Excel-shaped grid with the full column set — Applic. Type, Permit No.,
// Date Issued, Business Trade Name, Line/Kind of Business, Flr. Area,
// No. of Employee, Business Address, Owner's Name, Tel. No., SSSR,
// Date Inspected, Remarks.
//
// The two right-hand columns are the whole point of the system:
//
//   DATE INSPECTED and REMARKS are LIVE — computed from each establishment's
//   newest inspection_logs document, with REMARKS being the rating-scale
//   label of its score ("Excellent" / "Very Satisfactory" / "Satisfactory").
//   Only when an establishment has never been inspected through the app do
//   they fall back to the values typed in the imported spreadsheet, shown
//   muted-italic so the two sources can't be confused.
//
// Clicking a row opens the same inspection-history modal the Establishments
// page uses. The Export button writes the current filtered view back out as
// an .xlsx with the original masterlist column headers.

import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Download, Upload } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MasterlistImport } from "@/pages/MasterlistImport";
import { toast } from "sonner";
import { useCollection } from "@/lib/useCollection";
import {
  COLLECTIONS,
  mapEstablishment,
  mapInspectionLog,
  saveEstablishment,
} from "@/lib/firestore";
import type { Establishment, InspectionLog } from "@/lib/models";
import { formatShortDate, isoDatePart, latestLogByEstablishment as latestLogByEstablishment_ } from "@/lib/inspectionDates";
import { toYmd } from "@/lib/import/normalize";
import { barangayOfEstablishment, canonicalBarangay } from "@/lib/barangayGeo";
import { exportIncludesCategory } from "@/lib/exportPrefs";
import { exportMasterlistToExcel } from "@/lib/masterlistExport";
import { ratingColor, ratingLabel } from "@/lib/ratingScale";
import { EstablishmentHistoryModal } from "@/components/EstablishmentHistoryModal";
import { PageStrip } from "@/components/PageStrip";
import { useAuth } from "@/lib/useAuth";
import { logEvent } from "@/lib/auditEvents";

const PAGE_SIZE = 50;

// What one grid row shows. Resolved once per establishment in a useMemo so
// the table body is a plain map over finished values.
interface MasterlistRow {
  establishment: Establishment;
  /** Web-view-only column: the checklist category of the newest inspection
   *  (categorisation happens at inspection time, never at import), falling
   *  back to anything set on the record itself. Null = not yet categorised. */
  category: string | null;
  dateInspected: string | null; // display-ready ("Sep 28, 2026")
  /** The same date in canonical YYYY-MM-DD, for the Excel export. The export
   *  must never carry the display prose: exported files get re-imported by
   *  management, and a prose date would overwrite the stored canonical value
   *  on the round trip. */
  dateInspectedExport: string | null;
  /** The inspection score as the paper form's SSSR column held it. Live from
   *  the newest inspection's percentage; the spreadsheet's own SSSR text only
   *  when the establishment has never been inspected through the app. */
  sssr: string | null;
  /** The same score for the Excel export: a NUMBER when it is a real
   *  percentage, so the sheet can sort and average it, and the imported text
   *  verbatim otherwise. */
  sssrExport: number | string | null;
  remarks: string | null;
  remarksColor: string | null; // rating colour for live remarks, null for fallbacks
  /** True when dateInspected/remarks came from the imported spreadsheet
   *  rather than a real inspection — rendered muted so nobody mistakes a
   *  typed-in "Satisfactory" from last year's Excel for a live result. */
  fromImport: boolean;
}

export function Masterlist() {
  const { data: estData, isLoading: estLoading, error: estError } =
    useCollection(COLLECTIONS.establishments, mapEstablishment);
  const { data: logData } = useCollection(COLLECTIONS.inspectionLogs, mapInspectionLog);

  const [search, setSearch] = useState("");
  const [groupFilter, setGroupFilter] = useState<"all" | "food" | "non_food">("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [barangayFilter, setBarangayFilter] = useState("all");
  const [showDelisted, setShowDelisted] = useState(false);
  const [page, setPage] = useState(1);

  const [historyTarget, setHistoryTarget] = useState<Establishment | null>(null);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);

  // [REF: ESTABLISHMENT_DELIST]
  // The only place in the app that can set status="delisted" — the import
  // never deletes or delists on its own, it only reports candidates, and a
  // human pulls this lever. Restore exists because a delisted business that
  // reappears in a NEWER masterlist is also revived automatically by the
  // importer (newest-file-wins); this is the manual version of the same.
  const [delistBusy, setDelistBusy] = useState<string | null>(null);
  // Delisting is a write; RLS refuses it for a department head anyway.
  const canEdit = useAuth().role === "admin";
  const [importOpen, setImportOpen] = useState(false);
  const toggleDelisted = async (est: Establishment) => {
    const delisting = est.status !== "delisted";
    if (
      delisting &&
      !window.confirm(
        `Delist "${est.business_name}"? It will be hidden from the masterlist and mobile app, but all its inspections and history are kept.`,
      )
    ) {
      return;
    }
    setDelistBusy(est.id);
    try {
      await saveEstablishment(est.id, {
        status: delisting ? "delisted" : "active",
        updated_at: new Date().toISOString(),
      });
      toast.success(delisting ? `${est.business_name} delisted.` : `${est.business_name} restored.`);
    } catch {
      toast.error("Couldn't update the record. Check your connection and try again.");
    } finally {
      setDelistBusy(null);
    }
  };

  const latestLogByEstablishment = useMemo(() => latestLogByEstablishment_(logData ?? []), [logData]);

  // Map first, filter second: the Category column (and its filter) come from
  // the newest inspection log, so the filter needs the derived row, not the
  // raw establishment.
  const rows = useMemo<MasterlistRow[]>(() => {
    const needle = search.trim().toLowerCase();
    return (estData ?? [])
      .map((est): MasterlistRow => {
        const log = latestLogByEstablishment.get(est.id);
        // Categorisation happens at inspection time: the newest log's
        // checklist name wins; a value someone set on the record itself is
        // the fallback; most un-inspected records have neither.
        const category = log?.category_name ?? est.category ?? null;
        if (log && log.percentage_rating !== null) {
          return {
            establishment: est,
            category,
            dateInspected: formatShortDate(log.inspection_date),
            dateInspectedExport: isoDatePart(log.inspection_date),
            // One decimal: percentage_rating is a double, and "87.5" is the
            // number the inspector's own form showed them.
            sssr: `${log.percentage_rating.toFixed(1)}%`,
            sssrExport: log.percentage_rating,
            remarks: ratingLabel(log.percentage_rating),
            remarksColor: ratingColor(log.percentage_rating),
            fromImport: false,
          };
        }
        if (log) {
          // Inspected through the app but somehow unscored: the date is
          // real, so show it; remarks stay honest about having no rating.
          return {
            establishment: est,
            category,
            dateInspected: formatShortDate(log.inspection_date),
            dateInspectedExport: isoDatePart(log.inspection_date),
            // Inspected but unscored: there is no percentage to show, and the
            // spreadsheet's old SSSR would be a claim about this inspection
            // that nobody made.
            sssr: null,
            sssrExport: null,
            remarks: log.remarks,
            remarksColor: null,
            fromImport: false,
          };
        }
        return {
          establishment: est,
          category,
          dateInspected: est.import_date_inspected ?? null,
          dateInspectedExport: est.import_date_inspected ?? null,
          sssr: est.import_sssr ?? null,
          sssrExport: est.import_sssr ?? null,
          remarks: est.import_remarks ?? null,
          remarksColor: null,
          fromImport: Boolean(est.import_date_inspected || est.import_remarks || est.import_sssr),
        };
      })
      .filter((row) => {
        const est = row.establishment;
        if (!showDelisted && est.status === "delisted") return false;
        if (groupFilter !== "all" && est.group !== groupFilter) return false;
        if (categoryFilter !== "all" && row.category !== categoryFilter) return false;
        // Compared through canonicalBarangay so a record still holding an old
        // raw spelling ("Poblacion 022, Batangas City") is found by the
        // canonical option in the dropdown. Imports store the canonical name,
        // but records created by hand on the web form do not.
        if (barangayFilter !== "all" && (canonicalBarangay(barangayOfEstablishment(est)) ?? "") !== barangayFilter) {
          return false;
        }
        if (needle) {
          const haystack = [
            est.business_name,
            est.owner_name,
            est.business_permit_no,
            est.line_of_business,
            typeof est.address === "string" ? est.address : "",
            est.barangay,
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
          if (!haystack.includes(needle)) return false;
        }
        return true;
      })
      .sort((a, b) => a.establishment.business_name.localeCompare(b.establishment.business_name));
  }, [estData, latestLogByEstablishment, search, groupFilter, categoryFilter, barangayFilter, showDelisted]);

  // Barangay options, canonicalised and sorted. Built from the records
  // themselves rather than from the 105 official boundaries, so the dropdown
  // offers only places the masterlist actually covers.
  const barangayOptions = useMemo(() => {
    const names = new Set<string>();
    for (const est of estData ?? []) {
      const name = canonicalBarangay(barangayOfEstablishment(est));
      if (name) names.add(name);
    }
    return [...names].sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  }, [estData]);

  // Filter options come from the data itself — the categories that
  // inspections have actually assigned — not from the categories collection,
  // which holds every POSSIBLE checklist.
  const categoryOptions = useMemo(() => {
    const names = new Set<string>();
    for (const est of estData ?? []) {
      const name = latestLogByEstablishment.get(est.id)?.category_name ?? est.category;
      if (name) names.add(name);
    }
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [estData, latestLogByEstablishment]);

  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const clampedPage = Math.min(page, pageCount);
  const pageRows = rows.slice((clampedPage - 1) * PAGE_SIZE, clampedPage * PAGE_SIZE);

  // Any filter change can shrink the row set below the current page; render
  // from the clamped value and snap state back when they disagree.
  if (clampedPage !== page) setPage(clampedPage);

  const resetPage = () => setPage(1);

  const [isExporting, setIsExporting] = useState(false);

  const handleExport = async () => {
    setIsExporting(true);
    try {
      // toYmd (local date parts), not toISOString: a UTC slice stamps
      // yesterday's date on any export before 8 AM in Batangas.
      const today = toYmd(new Date());
      const result = await exportMasterlistToExcel(
        // The whole filtered set, not just the visible page — "export what I'm
        // looking at" means the filter, not the pagination window.
        rows.map((r) => ({
          establishment: r.establishment,
          category: r.category,
          dateInspected: r.dateInspectedExport,
          sssr: r.sssrExport,
          remarks: r.remarks,
        })),
        {
          // The Category column only ships when the Settings toggle says so:
          // the official masterlist format has no such column, and for
          // anything not yet inspected it would be empty anyway.
          includeCategory: exportIncludesCategory(),
          fileName: `masterlist-${groupFilter === "all" ? "all" : groupFilter}-${today}.xlsx`,
        },
      );

      logEvent("EXPORT", `Masterlist to Excel, ${result.rows} rows (${groupFilter === "all" ? "food & non-food" : groupFilter.replace("_", "-")})`);
      toast.success(`Exported ${result.rows} rows.`);
    } catch (err) {
      toast.error("Couldn't build the Excel file. Check your connection and try again.");
      console.error("[Masterlist] export failed", err);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="flex flex-col h-full gap-6">
      <div className="flex items-center justify-between flex-wrap gap-3 flex-shrink-0">
        <div>
          <h2 className="font-bold text-slate-900 text-2xl tracking-tight">Masterlist</h2>
          <p className="text-muted-foreground mt-1 text-sm font-medium">
            The full masterlist view. Date Inspected and Remarks are live from field inspections.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canEdit && (
            <Button variant="outline" onClick={() => setImportOpen(true)} className="font-bold">
              <Upload className="w-4 h-4 mr-2" />
              Import
            </Button>
          )}
          <Button
            onClick={() => void handleExport()}
            disabled={rows.length === 0 || isExporting}
            className="bg-primary hover:bg-primary/90 text-primary-foreground font-bold shadow-sm"
          >
            <Download className="w-4 h-4 mr-2" />
            {isExporting ? "Building file…" : "Export to Excel"}
          </Button>
        </div>
      </div>

      {/* The importer keeps its own state while open; closing mid-run is the
          same as closing the old tab (see MasterlistImport's header note). */}
      {canEdit && (
        <Dialog open={importOpen} onOpenChange={setImportOpen}>
          <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="text-slate-900 font-bold">Masterlist Import</DialogTitle>
              <DialogDescription>
                Upload the Excel masterlist from upper management. Inspection results are never touched by an import.
              </DialogDescription>
            </DialogHeader>
            <MasterlistImport />
          </DialogContent>
        </Dialog>
      )}

      <div className="flex items-center gap-3 flex-wrap flex-shrink-0">
        <input
          type="search"
          value={search}
          onChange={(e) => { setSearch(e.target.value); resetPage(); }}
          placeholder="Search name, owner, permit no., address…"
          className="w-72 text-sm font-medium border border-border rounded-lg px-3 py-2 bg-white text-slate-900"
        />
        <select
          value={groupFilter}
          onChange={(e) => { setGroupFilter(e.target.value as typeof groupFilter); resetPage(); }}
          className="text-sm font-medium border border-border rounded-lg px-3 py-2 bg-white text-slate-900"
        >
          <option value="all">Food & Non-Food</option>
          <option value="food">Food</option>
          <option value="non_food">Non-Food</option>
        </select>
        <select
          value={categoryFilter}
          onChange={(e) => { setCategoryFilter(e.target.value); resetPage(); }}
          className="text-sm font-medium border border-border rounded-lg px-3 py-2 bg-white text-slate-900 max-w-56"
        >
          <option value="all">All categories</option>
          {categoryOptions.map((name) => (
            <option key={name} value={name}>{name}</option>
          ))}
        </select>
        <select
          value={barangayFilter}
          onChange={(e) => { setBarangayFilter(e.target.value); resetPage(); }}
          className="text-sm font-medium border border-border rounded-lg px-3 py-2 bg-white text-slate-900 max-w-56"
        >
          <option value="all">All barangays</option>
          {barangayOptions.map((name) => (
            <option key={name} value={name}>{name}</option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm font-medium text-slate-600 cursor-pointer">
          <input
            type="checkbox"
            checked={showDelisted}
            onChange={(e) => { setShowDelisted(e.target.checked); resetPage(); }}
          />
          Show delisted
        </label>
        <span className="text-sm text-muted-foreground font-medium ml-auto tabular-nums">
          {rows.length} establishments
        </span>
      </div>

      <Card className="flex-1 overflow-hidden flex flex-col bg-white rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] border-border">
        {estLoading ? (
          <div className="p-12 text-center my-auto">
            <div className="w-8 h-8 border-4 border-primary/30 border-t-primary rounded-full animate-spin mx-auto" />
            <p className="text-sm text-muted-foreground font-medium mt-4">Loading the masterlist…</p>
          </div>
        ) : estError ? (
          <div className="p-12 text-center my-auto">
            <p className="text-muted-foreground font-bold">Couldn't load the masterlist.</p>
            <p className="text-sm text-muted-foreground font-medium mt-1">Check your connection — this list is read live from the server.</p>
          </div>
        ) : rows.length === 0 ? (
          <div className="p-12 text-center my-auto">
            <p className="text-muted-foreground font-bold">Nothing matches these filters.</p>
            <p className="text-sm text-muted-foreground font-medium mt-1">If the list is empty, import a masterlist first.</p>
          </div>
        ) : (
          <>
            {/* Both axes scroll inside the card: 15 columns will not fit any
                laptop, and the page body must never scroll sideways. */}
            <div className="flex-1 overflow-auto min-h-0">
              <table className="text-left border-collapse whitespace-nowrap min-w-full">
                <thead className="sticky top-0 bg-slate-50 z-10 shadow-sm">
                  <tr className="divide-x divide-slate-200">
                    {["No.", "Applic. Type", "Permit No.", "Date Issued", "Business Trade Name",
                      "Line/Kind of Business", "Flr. Area", "Employees", "Business Address", "Barangay",
                      "Owner's Name", "Tel. No.", "SSSR", "Date Inspected", "Remarks", "Category", ""].map((h) => (
                      <th key={h} className="py-2.5 px-3 text-[10px] font-extrabold tracking-wider text-slate-500 uppercase border-b border-border">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {pageRows.map((row, i) => {
                    const est = row.establishment;
                    return (
                      <tr
                        key={est.id}
                        className={`divide-x divide-slate-100 hover:bg-slate-50 transition-colors cursor-pointer ${est.status === "delisted" ? "opacity-50" : ""}`}
                        tabIndex={0}
                        aria-haspopup="dialog"
                        onClick={() => { setHistoryTarget(est); setIsHistoryOpen(true); }}
                        onKeyDown={(e) => {
                          if (e.target !== e.currentTarget) return;
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            setHistoryTarget(est);
                            setIsHistoryOpen(true);
                          }
                        }}
                      >
                        <td className="py-2 px-3 text-xs text-slate-400 font-medium tabular-nums">
                          {(clampedPage - 1) * PAGE_SIZE + i + 1}
                        </td>
                        <td className="py-2 px-3 text-xs text-slate-600 font-medium capitalize">{est.applic_type ?? "—"}</td>
                        <td className="py-2 px-3 text-xs text-slate-900 font-bold tabular-nums">{est.business_permit_no ?? "—"}</td>
                        <td className="py-2 px-3 text-xs text-slate-600 font-medium tabular-nums">{est.permit_date_issued ?? "—"}</td>
                        <td className="py-2 px-3 text-sm text-slate-900 font-bold max-w-64 truncate" title={est.business_name}>
                          {est.business_name || "—"}
                          <span className="sr-only">— press Enter to view inspection history</span>
                        </td>
                        <td className="py-2 px-3 text-xs text-slate-600 font-medium max-w-56 truncate" title={est.line_of_business ?? undefined}>{est.line_of_business ?? "—"}</td>
                        <td className="py-2 px-3 text-xs text-slate-600 font-medium tabular-nums text-right">{est.floor_area_sqm ?? "—"}</td>
                        <td className="py-2 px-3 text-xs text-slate-600 font-medium tabular-nums text-right">{est.personnel_count ?? "—"}</td>
                        <td className="py-2 px-3 text-xs text-slate-600 font-medium max-w-64 truncate" title={typeof est.address === "string" ? est.address : undefined}>
                          {typeof est.address === "string" && est.address ? est.address : "—"}
                        </td>
                        <td className="py-2 px-3 text-xs text-slate-600 font-medium">{est.barangay ?? "—"}</td>
                        <td className="py-2 px-3 text-xs text-slate-600 font-medium max-w-48 truncate" title={est.owner_name ?? undefined}>{est.owner_name ?? "—"}</td>
                        <td className="py-2 px-3 text-xs text-slate-600 font-medium tabular-nums">{est.tel_no ?? "—"}</td>
                        {/* Same colour as the Remarks badge beside it, so the
                            score and the band it falls in read as one answer. */}
                        <td
                          className={`py-2 px-3 text-xs tabular-nums text-right ${
                            row.fromImport ? "text-slate-400 italic font-medium" : "font-bold"
                          }`}
                          style={!row.fromImport && row.remarksColor ? { color: row.remarksColor } : undefined}
                        >
                          {row.sssr ?? <span className="text-slate-400 font-medium">—</span>}
                        </td>
                        <td className={`py-2 px-3 text-xs font-medium tabular-nums ${row.fromImport ? "text-slate-400 italic" : "text-slate-900"}`}>
                          {row.dateInspected ?? "—"}
                        </td>
                        <td className="py-2 px-3 text-xs">
                          {row.remarks === null ? (
                            <span className="text-slate-400">—</span>
                          ) : row.remarksColor ? (
                            <span
                              className="inline-flex items-center px-2 py-0.5 rounded-full font-bold text-white"
                              style={{ backgroundColor: row.remarksColor }}
                            >
                              {row.remarks}
                            </span>
                          ) : (
                            <span className={`font-medium ${row.fromImport ? "text-slate-400 italic" : "text-slate-600"}`}>{row.remarks}</span>
                          )}
                        </td>
                        <td
                          className="py-2 px-3 text-xs text-slate-600 font-medium"
                          title="Assigned by inspections (the checklist used) — not part of the uploaded Excel"
                        >
                          {row.category ?? "—"}
                        </td>
                        <td className="py-2 px-3">
                          {/* stopPropagation: this button lives inside a row
                              whose click opens the history modal. */}
                          {canEdit ? (
                            <button
                              type="button"
                              disabled={delistBusy === est.id}
                              onClick={(e) => { e.stopPropagation(); void toggleDelisted(est); }}
                              className={`text-xs font-bold px-2 py-1 rounded-md border transition-colors disabled:opacity-50 ${
                                est.status === "delisted"
                                  ? "border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                                  : "border-border text-slate-500 hover:bg-slate-100"
                              }`}
                            >
                              {est.status === "delisted" ? "Restore" : "Delist"}
                            </button>
                          ) : (
                            <span className="text-xs text-slate-500">
                              {est.status === "delisted" ? "Delisted" : "Active"}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="border-t border-border p-3 flex items-center justify-between flex-wrap gap-2">
              <p className="text-xs text-muted-foreground font-medium">
                SSSR, Date Inspected and Remarks come from the latest field inspection.
                Muted-italic values were typed in the imported Excel instead — not yet
                confirmed by an inspection through the app.
              </p>
              <PageStrip current={clampedPage} pageCount={pageCount} onPageChange={setPage} />
            </div>
          </>
        )}
      </Card>

      <EstablishmentHistoryModal
        open={isHistoryOpen}
        onOpenChange={setIsHistoryOpen}
        establishment={historyTarget}
      />
    </div>
  );
}
