import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { User, ClipboardCheck, CheckCircle2 } from "lucide-react";
import { useCollection } from "@/lib/useCollection";
import {
  COLLECTIONS,
  mapEstablishment,
  mapInspectionLog,
  mapInspector,
  mapProfile,
} from "@/lib/firestore";
import type { InspectionLog } from "@/lib/models";
import { barangayOfEstablishment, canonicalBarangay } from "@/lib/barangayGeo";
import { byNewestFirst, isoDatePart, isoTimePart } from "@/lib/inspectionDates";
import { ratingColor, ratingLabel } from "@/lib/ratingScale";

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

interface InspectorRow {
  id: string;
  name: string;
  /** Every log this inspector wrote, whatever the period. */
  logs: InspectionLog[];
}

// [REF: INSPECTOR_DIRECTORY]
//
// The list shown here is a merge of every place a real inspector can exist:
//  1. the admin-curated `inspectors` directory (read-only here; it fills
//     itself from accounts and inspection records, so there is nothing to
//     add by hand),
//  2. officer accounts in `profiles` — only that role, since the table also
//     holds admins, unactivated 'pending' signups and establishment owners
//     (readable by admins only — a permission error on that source just means
//     it's unavailable, not that the page failed), and
//  3. names found on submitted `inspection_logs`.
// Inspection counts are always derived live from the logs.
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

    for (const d of data ?? []) {
      if (d.email) seenEmails.add(d.email.trim().toLowerCase());
      merged.push({ id: d.id, name: d.name, logs: claim(d.name, d.email)?.logs ?? [] });
    }

    // Registered mobile accounts that aren't in the directory. Officers
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
        logs: s?.logs ?? [],
      });
    }

    // Inspectors who only exist as names on submitted logs.
    for (const [key, s] of byName) {
      merged.push({ id: `log:${key}`, name: s.name, logs: s.logs });
    }

    return merged;
  }, [data, profiles, logs]);

  // Period figures per inspector. "All days" averages over the span since
  // that inspector's first log (one week at least); a fixed window averages
  // over the window itself.
  const summaries = useMemo(() => {
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
    return new Map(inspectors.map((i) => [i.id, summarize(i)] as const));
  }, [inspectors, since, periodSpec.days, todayKey, barangayOf]);

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

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="font-bold text-slate-900 text-2xl tracking-tight">Inspectors</h2>
          <p className="text-muted-foreground mt-1">Field inspectors and their inspections</p>
        </div>
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
            <p className="text-muted-foreground font-bold">No inspectors yet.</p>
            <p className="text-sm text-muted-foreground">
              Inspectors appear here once an officer account is activated or submits an inspection.
            </p>
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {inspectors.map((inspector) => {
            const s = summaries.get(inspector.id)!;
            return (
              // The whole card opens the details; a real button keeps it
              // reachable by keyboard and screen reader.
              <button
                key={inspector.id}
                type="button"
                onClick={() => openDetails(inspector)}
                aria-haspopup="dialog"
                className="text-left bg-white rounded-xl border border-border shadow-sm hover:shadow-md hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 transition-all p-5"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-12 h-12 rounded-xl bg-emerald-50 flex items-center justify-center flex-shrink-0">
                    <User className="w-6 h-6 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-bold text-slate-900 text-lg leading-tight truncate" title={inspector.name}>{inspector.name}</h3>
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
              </button>
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
          <div className="overflow-auto -mx-6 px-6 flex-1 min-h-0">
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
    </div>
  );
}
