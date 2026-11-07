import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  User, ClipboardCheck, Award, Plus, Trash2, Pencil, CheckCircle2, LineChart, TrendingUp,
} from "lucide-react";
import { useCollection } from "@/lib/useCollection";
import {
  COLLECTIONS,
  deleteInspector,
  mapEstablishment,
  mapInspectionLog,
  mapInspector,
  mapProfile,
  saveInspector,
} from "@/lib/firestore";
import type { InspectionLog, Inspector } from "@/lib/models";
import { useAuth } from "@/lib/useAuth";
import { barangayOfEstablishment, canonicalBarangay } from "@/lib/barangayGeo";
import { byNewestFirst, isoDatePart, isoTimePart } from "@/lib/inspectionDates";
import { ratingColor, ratingLabel } from "@/lib/ratingScale";
import { toast } from "sonner";

function getStatusColor(status: string) {
  return status === "Active" ? "var(--primary)" : "var(--muted-foreground)";
}

function getPerformanceColor(performance: string) {
  switch (performance) {
    case "Excellent": return "var(--primary)";
    case "Good": return "#F59E0B";
    default: return "var(--muted-foreground)";
  }
}

const EMPTY_FORM = {
  name: "",
  inspectorId: "",
  email: "",
  phone: "",
  status: "Active",
  performance: "Good",
};

// Synthetic rows (accounts and log-only inspectors) aren't documents in the
// `inspectors` directory, so they can't be edited or deleted in place — the
// admin can promote one into the directory instead.
function isDirectoryEntry(inspector: Inspector): boolean {
  return !inspector.id.startsWith("profile:") && !inspector.id.startsWith("log:");
}

// [REF: INSPECTOR_PERIOD]
// Every figure on this page is scoped to one of these windows. Days are
// counted on the local calendar day, the same convention as the todayKey
// below, so "Today" means today's date and "Last 3 days" is today and the
// two before it.
const PERIODS = [
  { key: "all", label: "All days", days: null },
  { key: "30", label: "Last 30 days", days: 30 },
  { key: "7", label: "Last 7 days", days: 7 },
  { key: "3", label: "Last 3 days", days: 3 },
  { key: "today", label: "Today", days: 1 },
] as const;
type PeriodKey = (typeof PERIODS)[number]["key"];

const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const daysAgoKey = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return dayKey(d);
};

/** Logs on or after `since` (a yyyy-mm-dd key), or all when null. */
function inWindow(logs: InspectionLog[], since: string | null, before: string | null = null) {
  return logs.filter((l) => {
    const day = isoDatePart(l.inspection_date);
    return day !== "" && (since === null || day >= since) && (before === null || day < before);
  });
}

interface InspectorRow extends Inspector {
  /** Every log this inspector wrote, whatever the period. */
  logs: InspectionLog[];
}

// [REF: INSPECTOR_DIRECTORY]
//
// The list shown here is a merge of every place a real inspector can exist:
//  1. the admin-curated `inspectors` directory,
//  2. officer accounts in `profiles` — only that role, since the table also
//     holds admins, unactivated 'pending' signups and establishment owners
//     (readable by admins only — a permission error on that source just means
//     it's unavailable, not that the page failed), and
//  3. names found on submitted `inspection_logs`.
// Inspection counts are always derived live from the logs, because no client
// keeps the directory's counter fields up to date.
export function Inspectors() {
  const { data, error } = useCollection(COLLECTIONS.inspectors, mapInspector);
  const { data: profiles } = useCollection(COLLECTIONS.profiles, mapProfile);
  const { data: logs } = useCollection(COLLECTIONS.inspectionLogs, mapInspectionLog);
  const { data: establishments } = useCollection(COLLECTIONS.establishments, mapEstablishment);

  const [period, setPeriod] = useState<PeriodKey>("all");
  const periodSpec = PERIODS.find((p) => p.key === period)!;
  const todayKey = dayKey(new Date());
  const since = periodSpec.days === null ? null : daysAgoKey(periodSpec.days - 1);

  // Official barangay spelling per establishment, for the per-inspector
  // coverage count and the barangay filter in the details dialog.
  const barangayOf = useMemo(() => {
    const m = new Map<string, string | null>();
    for (const e of establishments ?? []) m.set(e.id, canonicalBarangay(barangayOfEstablishment(e)));
    return (log: InspectionLog) => (log.establishment_id ? m.get(log.establishment_id) ?? null : null);
  }, [establishments]);

  const inspectors = useMemo(() => {
    const directory = data ?? [];

    // Per-inspector logs, keyed by the normalised `inspector_name` the
    // mobile client stamps on each log (displayName, falling back to email).
    const byName = new Map<string, { name: string; logs: InspectionLog[] }>();
    for (const log of logs ?? []) {
      const name = (log.inspector_name ?? "").trim();
      if (!name) continue;
      const key = name.toLowerCase();
      const s = byName.get(key) ?? { name, logs: [] };
      s.logs.push(log);
      byName.set(key, s);
    }
    const claim = (...candidates: (string | null | undefined)[]) => {
      for (const c of candidates) {
        const key = c?.trim().toLowerCase();
        if (!key) continue;
        const s = byName.get(key);
        if (s) {
          byName.delete(key);
          return s;
        }
      }
      return null;
    };

    const merged: InspectorRow[] = [];
    const seenEmails = new Set<string>();

    for (const d of directory) {
      if (d.email) seenEmails.add(d.email.trim().toLowerCase());
      // Live off the logs, never the stored columns: a stale directory counter
      // used to outrank the real count and could only ever climb.
      merged.push({ ...d, totalInspections: 0, completedToday: 0, logs: claim(d.name, d.email)?.logs ?? [] });
    }

    // Registered mobile accounts that aren't in the directory yet. Officers
    // only: 'pending' signups and establishment owners are not inspectors.
    for (const p of profiles ?? []) {
      if (p.role !== "officer") continue;
      const email = p.email.trim().toLowerCase();
      if (!email || seenEmails.has(email)) continue;
      seenEmails.add(email);
      const s = claim(p.email, p.email.split("@")[0]);
      merged.push({
        id: `profile:${p.id}`,
        name: s?.name ?? p.email.split("@")[0],
        inspectorId: "Registered account",
        email: p.email,
        phone: "—",
        status: "Active",
        performance: "Unrated",
        totalInspections: 0,
        completedToday: 0,
        updated_at: p.created_at ?? "",
        logs: s?.logs ?? [],
      });
    }

    // Inspectors who only exist as names on submitted logs.
    for (const [key, s] of byName) {
      merged.push({
        id: `log:${key}`,
        name: s.name,
        inspectorId: "From inspection records",
        email: s.name.includes("@") ? s.name : "—",
        phone: "—",
        status: "Active",
        performance: "Unrated",
        totalInspections: 0,
        completedToday: 0,
        updated_at: "",
        logs: s.logs,
      });
    }

    return merged;
  }, [data, profiles, logs]);

  // Period figures per inspector. "All days" averages over the span since
  // that inspector's first log (one week at least); a fixed window averages
  // over the window itself.
  const summarize = (row: InspectorRow) => {
    const scoped = inWindow(row.logs, since);
    const brgys = new Set<string>();
    const ests = new Set<string>();
    let earliest = todayKey;
    for (const l of scoped) {
      const b = barangayOf(l);
      if (b) brgys.add(b);
      if (l.establishment_id) ests.add(l.establishment_id);
      const day = isoDatePart(l.inspection_date);
      if (day && day < earliest) earliest = day;
    }
    const spanDays = periodSpec.days ??
      Math.max(7, Math.round((Date.parse(todayKey) - Date.parse(earliest)) / 86_400_000) + 1);
    return {
      total: scoped.length,
      today: scoped.filter((l) => isoDatePart(l.inspection_date) === todayKey).length,
      barangays: brgys.size,
      establishments: ests.size,
      // Meaningless below a week: two inspections today would read as 14/wk.
      perWeek: spanDays < 7 ? null : Math.round((scoped.length / spanDays) * 7 * 10) / 10,
    };
  };
  const summaries = useMemo(
    () => new Map(inspectors.map((i) => [i.id, summarize(i)] as const)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [inspectors, since, barangayOf],
  );

  // Header figures for the same window, with the previous window of equal
  // length for the comparison (none for "All days").
  const header = useMemo(() => {
    const all = inspectors.flatMap((i) => i.logs);
    const scoped = inWindow(all, since);
    const previous = periodSpec.days === null
      ? null
      : inWindow(all, daysAgoKey(periodSpec.days * 2 - 1), since).length;
    const rated = scoped.filter((l) => l.percentage_rating != null);
    const avg = rated.length
      ? Math.round(rated.reduce((a, l) => a + (l.percentage_rating ?? 0), 0) / rated.length)
      : null;
    const active = inspectors.filter((i) => (summaries.get(i.id)?.total ?? 0) > 0).length;
    return { inspections: scoped.length, previous, avg, active };
  }, [inspectors, since, periodSpec.days, summaries]);

  // Most common performance rating across the team — from the real
  // per-inspector `performance` field, not a hard-coded label.
  const typicalPerformance = (() => {
    const counts = new Map<string, number>();
    for (const i of inspectors) {
      if (i.performance && i.performance !== "Unrated") {
        counts.set(i.performance, (counts.get(i.performance) ?? 0) + 1);
      }
    }
    let best: string | null = null;
    for (const [label, count] of counts) {
      if (best === null || count > (counts.get(best) ?? 0)) best = label;
    }
    return best;
  })();
  const { role } = useAuth();
  const isAdmin = role === "admin";

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);

  function openAdd() {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setIsDialogOpen(true);
  }

  // Promote a synthetic row (registered account / log-only name) into a real
  // directory document: an "add" prefilled with what we already know.
  function openAddFrom(inspector: Inspector) {
    setForm({
      ...EMPTY_FORM,
      name: inspector.name,
      email: inspector.email === "—" ? "" : inspector.email,
    });
    setEditingId(null);
    setIsDialogOpen(true);
  }

  function openEdit(inspector: Inspector) {
    setForm({
      name: inspector.name,
      inspectorId: inspector.inspectorId,
      email: inspector.email,
      phone: inspector.phone,
      status: inspector.status,
      performance: inspector.performance,
    });
    setEditingId(inspector.id);
    setIsDialogOpen(true);
  }

  async function handleSave() {
    if (!form.name || !form.inspectorId || !form.email || !form.phone) {
      toast.error("Please fill in all required fields.");
      return;
    }
    setIsSaving(true);
    try {
      // Inspection counters belong to the inspection flow, not to this form:
      // carry the STORED values through so an edit neither zeroes them nor
      // rewrites them. Read from `data` (the raw directory), never from the
      // live log-derived figures.
      const existing = editingId ? (data ?? []).find((i) => i.id === editingId) : null;

      await saveInspector(editingId, {
        ...form,
        totalInspections: existing?.totalInspections ?? 0,
        completedToday: existing?.completedToday ?? 0,
      });

      toast.success(editingId ? "Inspector updated." : "Inspector added.");
      setIsDialogOpen(false);
    } catch (err: any) {
      toast.error(err?.message || "Failed to save inspector.");
    } finally {
      setIsSaving(false);
    }
  }

  const [deleteTarget, setDeleteTarget] = useState<Inspector | null>(null);

  async function handleDelete() {
    if (!deleteTarget) return;
    try {
      await deleteInspector(deleteTarget.id);
      toast.success("Inspector deleted.");
      setDeleteTarget(null);
    } catch (err: any) {
      toast.error(err?.message || "Failed to delete inspector.");
    }
  }

  // [REF: INSPECTOR_DETAILS]
  // One inspector's inspections, every period, with a barangay filter and an
  // establishment search. The date sits beside each row so repeat visits to
  // the same establishment stay distinguishable.
  const [detailsFor, setDetailsFor] = useState<InspectorRow | null>(null);
  const [detailSearch, setDetailSearch] = useState("");
  const [detailBarangay, setDetailBarangay] = useState("all");
  function openDetails(row: InspectorRow) {
    setDetailSearch("");
    setDetailBarangay("all");
    setDetailsFor(row);
  }
  const detailRows = useMemo(() => {
    if (!detailsFor) return [];
    const needle = detailSearch.trim().toLowerCase();
    return detailsFor.logs
      .map((l) => ({ log: l, barangay: barangayOf(l) }))
      .filter(({ log, barangay }) =>
        (detailBarangay === "all" || barangay === detailBarangay) &&
        (needle === "" || (log.establishment_name ?? "").toLowerCase().includes(needle)))
      .sort((a, b) => byNewestFirst(a.log, b.log));
  }, [detailsFor, detailSearch, detailBarangay, barangayOf]);
  const detailBarangays = useMemo(
    () => [...new Set((detailsFor?.logs ?? []).map(barangayOf).filter((b): b is string => !!b))]
      .sort((a, b) => a.localeCompare(b, "en", { numeric: true })),
    [detailsFor, barangayOf],
  );

  const delta = header.previous === null ? null : header.inspections - header.previous;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="font-bold text-slate-900 text-2xl tracking-tight">Inspectors</h2>
          <p className="text-muted-foreground mt-1">Manage inspection team members</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {/* Period */}
          <div role="radiogroup" aria-label="Period" className="inline-flex rounded-lg border border-border bg-white p-1">
            {PERIODS.map((p) => (
              <button
                key={p.key}
                type="button"
                role="radio"
                aria-checked={period === p.key}
                onClick={() => setPeriod(p.key)}
                className={`px-3 py-1.5 text-xs font-bold rounded-md transition-colors ${
                  period === p.key ? "bg-primary text-primary-foreground shadow-sm" : "text-slate-600 hover:bg-slate-50"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          {isAdmin && (
            <Button
              onClick={openAdd}
              className="bg-primary hover:bg-primary/90 text-primary-foreground shadow-sm font-bold"
            >
              <Plus className="w-4 h-4 mr-2" />
              Add Inspector
            </Button>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="p-5 bg-white rounded-xl">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">Total Inspectors</p>
          <div className="flex items-end justify-between gap-2">
            <h3 className="font-black text-slate-900 text-3xl leading-none">{inspectors.length}</h3>
            <span className="text-xs font-bold text-emerald-700 bg-emerald-50 rounded-full px-2.5 py-1">
              {inspectors.length ? Math.round((inspectors.filter((i) => i.status === "Active").length / inspectors.length) * 100) : 0}% Active
            </span>
          </div>
        </Card>
        <Card className="p-5 bg-white rounded-xl">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">Active · {periodSpec.label}</p>
          <div className="flex items-end justify-between gap-2">
            <h3 className="font-black text-primary text-3xl leading-none">{header.active}</h3>
            <span className="text-sm text-slate-400 font-medium">in the field</span>
          </div>
        </Card>
        <Card className="p-5 bg-white rounded-xl">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">Inspections · {periodSpec.label}</p>
          <div className="flex items-end justify-between gap-2">
            <h3 className="font-black text-slate-900 text-3xl leading-none">{header.inspections}</h3>
            {delta !== null && (
              <span className={`text-xs font-bold rounded-full px-2.5 py-1 ${delta >= 0 ? "text-emerald-700 bg-emerald-50" : "text-red-700 bg-red-50"}`}>
                {delta >= 0 ? "+" : ""}{delta} vs previous {periodSpec.days === 1 ? "day" : `${periodSpec.days} days`}
              </span>
            )}
          </div>
        </Card>
        <Card className="p-5 bg-white rounded-xl">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">Typical Performance</p>
          <div className="flex items-end justify-between gap-2">
            <h3 className="font-black text-primary text-3xl leading-none">{typicalPerformance ?? "N/A"}</h3>
            <span className="text-sm text-slate-400 font-medium">
              {header.avg === null ? "no rated inspections" : `${header.avg}% compliance`}
            </span>
          </div>
        </Card>
      </div>

      <p className="text-sm font-bold text-slate-500 uppercase tracking-wider">Field Inspectors Directory</p>

      {/* Inspector cards */}
      {error ? (
        <Card className="p-12 bg-white rounded-xl text-center">
          <div className="flex flex-col items-center gap-3">
            <div className="w-14 h-14 rounded-full bg-amber-50 flex items-center justify-center">
              <User className="w-7 h-7 text-amber-500" />
            </div>
            <p className="text-muted-foreground font-bold">Couldn't load the inspector list.</p>
            <p className="text-sm text-muted-foreground">
              This directory is read live from the server — check your connection.
            </p>
          </div>
        </Card>
      ) : inspectors.length === 0 ? (
        <Card className="p-12 bg-white rounded-xl text-center">
          <div className="flex flex-col items-center gap-3">
            <div className="w-14 h-14 rounded-full bg-slate-100 flex items-center justify-center">
              <User className="w-7 h-7 text-slate-400" />
            </div>
            <p className="text-muted-foreground font-bold">No inspectors found.</p>
            {isAdmin && (
              <p className="text-sm text-muted-foreground">
                Click <strong>Add Inspector</strong> to get started.
              </p>
            )}
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {inspectors.map((inspector) => {
            const s = summaries.get(inspector.id)!;
            return (
              <Card key={inspector.id} className="bg-white rounded-xl hover:shadow-md transition-shadow flex flex-col overflow-hidden">
                <div className="p-5 flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex gap-3 min-w-0">
                      <div className="w-12 h-12 rounded-xl bg-emerald-50 flex items-center justify-center flex-shrink-0">
                        <User className="w-6 h-6 text-primary" />
                      </div>
                      <div className="min-w-0">
                        <h3 className="font-bold text-slate-900 text-lg leading-tight truncate" title={inspector.name}>{inspector.name}</h3>
                        <p className="text-sm text-muted-foreground font-medium truncate">{inspector.inspectorId}</p>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                      <span
                        className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold border whitespace-nowrap"
                        style={{
                          backgroundColor: `color-mix(in srgb, ${getStatusColor(inspector.status)} 12%, transparent)`,
                          color: getStatusColor(inspector.status),
                          borderColor: `color-mix(in srgb, ${getStatusColor(inspector.status)} 30%, transparent)`,
                        }}
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-current" />
                        {inspector.status}
                      </span>
                      <span
                        className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold border whitespace-nowrap"
                        style={{
                          backgroundColor: `color-mix(in srgb, ${getPerformanceColor(inspector.performance)} 12%, transparent)`,
                          color: getPerformanceColor(inspector.performance),
                          borderColor: `color-mix(in srgb, ${getPerformanceColor(inspector.performance)} 30%, transparent)`,
                        }}
                      >
                        <Award className="w-3 h-3" />
                        {inspector.performance}
                      </span>
                    </div>
                  </div>

                  <div className="mt-5 grid grid-cols-3 divide-x divide-slate-200 rounded-xl bg-slate-50 border border-slate-100 py-3 text-center">
                    <div className="px-2">
                      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Barangays</p>
                      <p className="text-xl font-black text-slate-900 tabular-nums">{s.barangays}</p>
                      <p className="text-xs text-muted-foreground font-medium">Covered</p>
                    </div>
                    <div className="px-2">
                      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Establishments</p>
                      <p className="text-xl font-black text-slate-900 tabular-nums">{s.establishments}</p>
                      <p className="text-xs text-muted-foreground font-medium">Audited</p>
                    </div>
                    <div className="px-2">
                      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Avg / wk</p>
                      <p className="text-xl font-black text-primary tabular-nums">{s.perWeek ?? "—"}</p>
                      <p className="text-xs text-muted-foreground font-medium">Inspections</p>
                    </div>
                  </div>

                  <div className="mt-4 flex items-center justify-between text-sm">
                    <span className="flex items-center gap-1.5 text-slate-600 font-medium">
                      <CheckCircle2 className="w-4 h-4 text-primary" />
                      <span className="font-bold text-slate-900 tabular-nums">{s.total}</span> total
                    </span>
                    <span className="text-slate-600 font-medium">
                      <span className="font-bold text-primary tabular-nums">{s.today}</span> completed today
                    </span>
                  </div>
                </div>

                <div className="border-t border-slate-100 px-5 py-3 flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => openDetails(inspector)}
                    className="inline-flex items-center gap-1.5 text-sm font-bold text-slate-700 hover:text-primary"
                  >
                    <LineChart className="w-4 h-4" />
                    Details
                  </button>
                  {isAdmin && (
                    isDirectoryEntry(inspector) ? (
                      <div className="flex items-center gap-3">
                        <button type="button" onClick={() => openEdit(inspector)} className="inline-flex items-center gap-1 text-sm font-bold text-slate-700 hover:text-primary">
                          <Pencil className="w-3.5 h-3.5" />
                          Edit
                        </button>
                        <button type="button" onClick={() => setDeleteTarget(inspector)} aria-label={`Delete ${inspector.name}`} className="text-slate-400 hover:text-red-600">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ) : (
                      <button type="button" onClick={() => openAddFrom(inspector)} className="inline-flex items-center gap-1 text-sm font-bold text-slate-700 hover:text-primary">
                        <Plus className="w-3.5 h-3.5" />
                        Add to directory
                      </button>
                    )
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Inspector details */}
      <Dialog open={detailsFor !== null} onOpenChange={(open) => { if (!open) setDetailsFor(null); }}>
        <DialogContent className="sm:max-w-3xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="text-slate-900 font-bold flex items-center gap-2">
              <ClipboardCheck className="w-5 h-5 text-primary" />
              {detailsFor?.name}
              <span className="text-sm font-medium text-muted-foreground">
                · {detailsFor?.logs.length ?? 0} inspection{detailsFor?.logs.length === 1 ? "" : "s"}
              </span>
            </DialogTitle>
          </DialogHeader>
          <div className="flex items-center gap-3 flex-wrap">
            <input
              type="search"
              value={detailSearch}
              onChange={(e) => setDetailSearch(e.target.value)}
              placeholder="Search establishment…"
              className="w-64 text-sm font-medium border border-border rounded-lg px-3 py-2 bg-white text-slate-900"
            />
            <select
              aria-label="Filter by barangay"
              value={detailBarangay}
              onChange={(e) => setDetailBarangay(e.target.value)}
              className="text-sm font-medium border border-border rounded-lg px-3 py-2 bg-white text-slate-900 max-w-56"
            >
              <option value="all">All barangays</option>
              {detailBarangays.map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
            <span className="text-sm text-muted-foreground font-medium ml-auto tabular-nums">
              {detailRows.length} shown
            </span>
          </div>
          <div className="overflow-y-auto -mx-6 px-6 flex-1 min-h-0">
            {detailRows.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">No inspections match.</p>
            ) : (
              <table className="w-full text-left border-collapse">
                <thead className="sticky top-0 bg-white border-b border-border">
                  <tr>
                    <th className="py-2 pr-4 text-[10px] font-extrabold tracking-wider text-slate-500 uppercase">Establishment</th>
                    <th className="py-2 pr-4 w-36 text-[10px] font-extrabold tracking-wider text-slate-500 uppercase">Date</th>
                    <th className="py-2 w-44 text-[10px] font-extrabold tracking-wider text-slate-500 uppercase">Rating</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {detailRows.map(({ log, barangay }) => (
                    <tr key={log.id}>
                      <td className="py-2.5 pr-4 min-w-0">
                        <p className="font-bold text-slate-900 text-sm truncate">{log.establishment_name || "Unknown Establishment"}</p>
                        {barangay && <p className="text-xs text-muted-foreground font-medium truncate">{barangay}</p>}
                      </td>
                      <td className="py-2.5 pr-4 text-sm text-slate-700 font-medium whitespace-nowrap tabular-nums">
                        {isoDatePart(log.inspection_date) || "—"}
                        <span className="text-xs text-muted-foreground"> {isoTimePart(log.inspection_date)}</span>
                      </td>
                      <td className="py-2.5">
                        {log.percentage_rating == null ? (
                          <span className="text-sm text-slate-400">—</span>
                        ) : (
                          <span
                            className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold border whitespace-nowrap"
                            style={{
                              backgroundColor: `color-mix(in srgb, ${ratingColor(log.percentage_rating)} 15%, transparent)`,
                              color: ratingColor(log.percentage_rating),
                              borderColor: `color-mix(in srgb, ${ratingColor(log.percentage_rating)} 30%, transparent)`,
                            }}
                          >
                            {ratingLabel(log.percentage_rating)} ({Number(log.percentage_rating.toFixed(1))}%)
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete */}
      <Dialog open={deleteTarget !== null} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-slate-900 font-bold">Delete inspector?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-slate-600">
            <span className="font-bold text-slate-900">{deleteTarget?.name}</span> will be removed from the directory. This cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button className="bg-red-600 hover:bg-red-700 text-white" onClick={handleDelete}>
              <Trash2 className="w-4 h-4 mr-1" />
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add / Edit */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-slate-900 font-bold">
              {editingId ? "Edit Inspector" : "Add Inspector"}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="name">Full Name <span className="text-red-500">*</span></Label>
                <Input id="name" placeholder="e.g. Juan Dela Cruz" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="inspectorId">Inspector ID <span className="text-red-500">*</span></Label>
                <Input id="inspectorId" placeholder="e.g. INSP-001" value={form.inspectorId} onChange={e => setForm(f => ({ ...f, inspectorId: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email <span className="text-red-500">*</span></Label>
              <Input id="email" type="email" placeholder="inspector@email.com" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone">Phone <span className="text-red-500">*</span></Label>
              <Input id="phone" placeholder="e.g. 09XX-XXX-XXXX" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Active">Active</SelectItem>
                    <SelectItem value="Inactive">Inactive</SelectItem>
                    <SelectItem value="On Leave">On Leave</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Performance</Label>
                <Select value={form.performance} onValueChange={v => setForm(f => ({ ...f, performance: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Excellent">Excellent</SelectItem>
                    <SelectItem value="Good">Good</SelectItem>
                    <SelectItem value="Needs Improvement">Needs Improvement</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)} disabled={isSaving}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={isSaving} className="bg-primary hover:bg-primary/90 text-primary-foreground font-bold">
              {isSaving ? (
                <div className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin mr-2" />
              ) : null}
              {editingId ? "Save Changes" : "Add Inspector"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
