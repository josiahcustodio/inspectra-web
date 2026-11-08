import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Building2, Edit2 } from "lucide-react";
import { useCollection } from "@/lib/useCollection";
import { COLLECTIONS, mapEstablishment, mapInspectionLog } from "@/lib/firestore";
import type { Establishment } from "@/lib/models";
import { useMemo, useState } from "react";
import { AddEstablishmentModal } from "@/components/AddEstablishmentModal";
import { EstablishmentHistoryModal } from "@/components/EstablishmentHistoryModal";
import { PageStrip } from "@/components/PageStrip";
import { barangayOfEstablishment, canonicalBarangay } from "@/lib/barangayGeo";
import { formatShortDate, latestLogByEstablishment } from "@/lib/inspectionDates";
import { complianceLabel, ratingColor } from "@/lib/ratingScale";
import { useAuth } from "@/lib/useAuth";

const PAGE_SIZE = 50;

export function Establishments() {
  const { data, isLoading, error } = useCollection(COLLECTIONS.establishments, mapEstablishment);
  const { data: logs, error: logsError } = useCollection(COLLECTIONS.inspectionLogs, mapInspectionLog);

  // Newest inspection per establishment, for the date and compliance columns.
  // `undefined` until the logs land, so the columns wait instead of showing
  // every row as never inspected for a moment.
  const latestLog = useMemo(() => (logs ? latestLogByEstablishment(logs) : undefined), [logs]);
  // RLS already refuses a department head's writes; hiding the controls spares
  // them a form whose every save fails.
  const canEdit = useAuth().role === "admin";
  const establishments = data ?? [];
  const [barangayFilter, setBarangayFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  // Compared through canonicalBarangay so old raw spellings match the dropdown,
  // same as the masterlist. Sorted because the snapshot has no fixed order, and
  // pages cut from an unordered list would repeat or skip records.
  const needle = search.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      (data ?? [])
        .filter((e) => barangayFilter === "all" || canonicalBarangay(barangayOfEstablishment(e)) === barangayFilter)
        .filter((e) =>
          !needle ||
          [e.business_name, e.owner_name, e.business_permit_no, e.sanitary_permit_no]
            .filter(Boolean).join(" ").toLowerCase().includes(needle))
        .sort((a, b) => a.business_name.localeCompare(b.business_name)),
    [data, barangayFilter, needle],
  );

  const barangayOptions = useMemo(() => {
    const names = new Set<string>();
    for (const e of data ?? []) {
      const name = canonicalBarangay(barangayOfEstablishment(e));
      if (name) names.add(name);
    }
    return [...names].sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  }, [data]);

  // Clamped so a live update that shrinks the list can't leave an empty page.
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pagedEstablishments = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedEstablishment, setSelectedEstablishment] = useState<Establishment | null>(null);

  // The history modal stays mounted so it keeps its close animation; `historyTarget`
  // is what it reads, and holding it after close avoids the name blanking mid-fade.
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [historyTarget, setHistoryTarget] = useState<Establishment | null>(null);

  const handleOpenModal = (establishment?: Establishment) => {
    setSelectedEstablishment(establishment || null);
    setIsModalOpen(true);
  };

  const handleOpenHistory = (establishment: Establishment) => {
    setHistoryTarget(establishment);
    setIsHistoryOpen(true);
  };

  return (
    <div className="flex flex-col h-full gap-6">
      <div className="flex items-center justify-between flex-wrap gap-3 flex-shrink-0">
        <div>
          <h2 className="font-bold text-slate-900 text-2xl tracking-tight">Establishments</h2>
          <p className="text-muted-foreground mt-1 text-sm font-medium">Manage all registered establishments</p>
        </div>
        {canEdit && (
          <Button onClick={() => handleOpenModal()} className="bg-primary hover:bg-primary/90 text-primary-foreground font-bold shadow-sm">
            Add Establishment
          </Button>
        )}
      </div>

      <div className="flex items-center gap-3 flex-wrap flex-shrink-0">
        <input
          type="search"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          placeholder="Search name, owner, permit no.…"
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
        <span className="text-sm text-muted-foreground font-medium ml-auto tabular-nums">
          {filtered.length} establishments
        </span>
      </div>

      <Card className="flex-1 overflow-hidden flex flex-col gap-0 bg-white rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] border-border">
        {isLoading ? (
          <div className="p-12 text-center my-auto">
            <div className="w-8 h-8 border-4 border-primary/30 border-t-primary rounded-full animate-spin mx-auto" />
            <p className="text-sm text-muted-foreground font-medium mt-4">Loading establishments...</p>
          </div>
        ) : error ? (
          <div className="p-12 text-center my-auto">
            <p className="text-muted-foreground font-bold">Couldn't load establishments.</p>
            <p className="text-sm text-muted-foreground font-medium mt-1">Check your connection — this list is read live from the server.</p>
          </div>
        ) : establishments.length === 0 ? (
          <div className="p-12 text-center my-auto">
            <p className="text-muted-foreground font-bold">No establishments yet.</p>
            <p className="text-sm text-muted-foreground font-medium mt-1">Add one to get started.</p>
          </div>
        ) : (
          <>
          {/* Keyed by page so a new page starts scrolled to the top. */}
          <div key={currentPage} className="flex-1 overflow-auto min-h-0">
            {/* [REF: ESTABLISHMENT_LIST] */}
            <table className="w-full text-left border-collapse">
              <thead className="sticky top-0 bg-white z-10 shadow-sm border-b border-border">
                <tr>
                  <th className="py-3 px-6 text-[10px] font-extrabold tracking-wider text-slate-500 uppercase">Establishment</th>
                  <th className="py-3 px-6 text-[10px] font-extrabold tracking-wider text-slate-500 uppercase">Owner</th>
                  <th className="py-3 px-6 text-[10px] font-extrabold tracking-wider text-slate-500 uppercase">Permit No.</th>
                  <th className="py-3 px-6 text-[10px] font-extrabold tracking-wider text-slate-500 uppercase hidden md:table-cell">Inspection Date</th>
                  <th className="py-3 px-6 text-[10px] font-extrabold tracking-wider text-slate-500 uppercase">Compliance</th>
                  <th className="py-3 px-6 text-[10px] font-extrabold tracking-wider text-slate-500 uppercase text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {pagedEstablishments.map((establishment) => {
                  const log = latestLog?.get(establishment.id);
                  const score = log?.percentage_rating ?? null;
                  return (
                  // [REF: ESTABLISHMENT_HISTORY_MODAL]
                  // The whole row opens the inspection history. No role="button"
                  // here on purpose — that would replace the row/cell semantics a
                  // screen reader needs to read the table, so the row stays a row
                  // and only becomes focusable and key-activatable.
                  <tr
                    key={establishment.id}
                    className="hover:bg-slate-50 transition-colors group cursor-pointer"
                    tabIndex={0}
                    // cursor-pointer is a mouse-only affordance, so name the
                    // action for anyone arriving by keyboard or screen reader.
                    aria-haspopup="dialog"
                    onClick={() => handleOpenHistory(establishment)}
                    onKeyDown={(e) => {
                      // Only the row's own key presses; without this, Space or
                      // Enter on the focused Edit button would open this modal too.
                      if (e.target !== e.currentTarget) return;
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        handleOpenHistory(establishment);
                      }
                    }}
                  >
                    <td className="py-4 px-6">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-indigo-50 flex items-center justify-center flex-shrink-0 border border-indigo-100">
                          <Building2 className="w-4 h-4 text-indigo-600" />
                        </div>
                        <span className="font-bold text-slate-900 text-sm">{establishment.business_name || "Unnamed establishment"}</span>
                        {/* The cue a sighted user gets from the row's hover and
                            cursor. Reads after the name, so the row announces
                            what it is before what it does. */}
                        <span className="sr-only">— press Enter to view inspection history</span>
                      </div>
                    </td>
                    <td className="py-4 px-6 text-sm text-slate-700 font-medium">
                      {establishment.owner_name || <span className="text-slate-400">N/A</span>}
                    </td>
                    <td className="py-4 px-6 text-sm text-slate-700 font-medium">
                      {establishment.business_permit_no || establishment.sanitary_permit_no || <span className="text-slate-400">N/A</span>}
                    </td>
                    <td className="py-4 px-6 text-sm text-slate-600 font-medium hidden md:table-cell">
                      {log?.inspection_date
                        ? formatShortDate(log.inspection_date)
                        : <span className="text-slate-400">—</span>}
                    </td>
                    <td className="py-4 px-6">
                      {latestLog && (
                        <span
                          className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold border whitespace-nowrap"
                          style={{
                            backgroundColor: `color-mix(in srgb, ${ratingColor(score)} 15%, transparent)`,
                            color: ratingColor(score),
                            borderColor: `color-mix(in srgb, ${ratingColor(score)} 30%, transparent)`,
                          }}
                        >
                          {complianceLabel(score)}
                        </span>
                      )}
                    </td>
                    <td className="py-4 px-6 text-right">
                      <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity focus-within:opacity-100">
                        {canEdit && (
                          <Button variant="outline" size="icon" onClick={(e) => { e.stopPropagation(); handleOpenModal(establishment); }} className="h-8 w-8 border-border text-slate-600 hover:text-indigo-600 hover:bg-indigo-50 hover:border-indigo-200 shadow-sm" title="Edit Establishment">
                            <Edit2 className="w-4 h-4" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {logsError && (
            <p className="px-6 py-2 text-xs text-red-700 bg-red-50 border-t border-red-200">
              Inspection dates and compliance could not be loaded: {logsError.message}
            </p>
          )}
          {filtered.length > PAGE_SIZE && (
            <div className="border-t border-border p-3 flex items-center justify-between flex-wrap gap-2">
              <p className="text-sm text-muted-foreground font-medium">
                Showing {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, filtered.length)} of {filtered.length} establishments
              </p>
              <PageStrip
                current={currentPage}
                pageCount={pageCount}
                onPageChange={setPage}
                className="mx-0 w-auto justify-end"
              />
            </div>
          )}
          </>
        )}
      </Card>

      <AddEstablishmentModal
        open={isModalOpen}
        onOpenChange={setIsModalOpen}
        establishmentToEdit={selectedEstablishment}
      />

      <EstablishmentHistoryModal
        open={isHistoryOpen}
        onOpenChange={setIsHistoryOpen}
        establishment={historyTarget}
      />
    </div>
  );
}
