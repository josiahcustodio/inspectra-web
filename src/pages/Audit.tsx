import { Fragment, useEffect, useState } from "react";
import { History, RefreshCw } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageStrip } from "@/components/PageStrip";
import { supabase } from "@/lib/supabase";

// [REF: AUDIT_TRAIL_PAGE]
// Reads public.audit_log, which only the audit_row() trigger writes
// (migration/sql/09_audit_trail.sql). Admin-only in RLS and in the route map.
// Server-side paging on purpose: the table grows for the life of the project,
// so unlike every other list this one is never read whole or kept live.

interface AuditRow {
  id: number;
  at: string;
  actor_id: string | null;
  actor_email: string | null;
  actor_role: string | null;
  table_name: string;
  row_id: string;
  row_label: string | null;
  action: "INSERT" | "UPDATE" | "DELETE";
  changed_fields: string[];
  old_row: Record<string, unknown> | null;
  new_row: Record<string, unknown> | null;
}

const PAGE_SIZE = 25;

const TABLE_LABEL: Record<string, string> = {
  inspection_logs: "Inspection",
  establishments: "Establishment",
  establishment_permits: "Permit",
  establishment_contacts: "Owner access",
  owner_access_rejections: "Owner access decision",
  profiles: "Account",
  inspectors: "Inspector",
  checklist_templates: "Checklist",
  categories: "Category",
};

const ACTION_COPY: Record<AuditRow["action"], { label: string; tone: string }> = {
  INSERT: { label: "Created", tone: "text-emerald-700 bg-emerald-50" },
  UPDATE: { label: "Updated", tone: "text-amber-700 bg-amber-50" },
  DELETE: { label: "Deleted", tone: "text-rose-700 bg-rose-50" },
};

// Snapshot columns too large or too opaque to be useful inline.
const BULKY = new Set(["results", "coordinates"]);

function show(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > 160 ? s.slice(0, 157) + "…" : s;
}

function whoLabel(r: AuditRow): string {
  if (r.actor_email) return r.actor_email;
  return r.actor_id ? "Unknown account" : "System";
}

export function Audit() {
  const [page, setPage] = useState(1);
  const [tableFilter, setTableFilter] = useState("all");
  const [actionFilter, setActionFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [rows, setRows] = useState<AuditRow[] | undefined>(undefined);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [fetching, setFetching] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFetching(true);
    const start = (page - 1) * PAGE_SIZE;
    let q = supabase
      .from("audit_log")
      .select("*", { count: "exact" })
      .order("at", { ascending: false })
      .range(start, start + PAGE_SIZE - 1);
    if (tableFilter !== "all") q = q.eq("table_name", tableFilter);
    if (actionFilter !== "all") q = q.eq("action", actionFilter);
    // "T00:00" makes the picker's date parse as LOCAL midnight; a bare
    // YYYY-MM-DD parses as UTC and would start the day at 08:00 here.
    if (from) q = q.gte("at", new Date(`${from}T00:00`).toISOString());
    if (to) q = q.lt("at", new Date(new Date(`${to}T00:00`).getTime() + 86_400_000).toISOString());
    // PostgREST's or() filter uses , ( ) as syntax; strip them so a typed
    // search can't change the query's shape (RLS would still hold, but the
    // query would fail with an opaque error).
    const term = search.trim().replace(/[,()]/g, "");
    if (term) q = q.or(`actor_email.ilike.%${term}%,row_label.ilike.%${term}%`);

    q.then(({ data, count, error }) => {
      if (cancelled) return;
      setFetching(false);
      if (error) {
        setError(error.message);
        setRows([]);
        return;
      }
      setError(null);
      setRows((data ?? []) as AuditRow[]);
      setTotal(count ?? 0);
    });
    return () => { cancelled = true; };
  }, [page, tableFilter, actionFilter, search, from, to, reloadKey]);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const resetPage = () => setPage(1);

  return (
    <div className="flex flex-col h-full gap-6">
      <div className="flex items-center justify-between flex-shrink-0">
        <div>
          <h2 className="font-bold text-slate-900 text-2xl tracking-tight">Audit Trail</h2>
          <p className="text-muted-foreground mt-1 text-sm font-medium">
            Who changed what, and when. Written by the database on every change; nobody can edit or delete it.
          </p>
        </div>
        <Button variant="outline" disabled={fetching} onClick={() => setReloadKey((k) => k + 1)}>
          <RefreshCw className={`w-4 h-4 mr-2 ${fetching ? "animate-spin" : ""}`} />
          {fetching ? "Refreshing…" : "Refresh"}
        </Button>
      </div>

      <div className="flex items-center gap-3 flex-wrap flex-shrink-0">
        <input
          type="search"
          aria-label="Search by account or record"
          placeholder="Search account or record…"
          value={search}
          onChange={(e) => { setSearch(e.target.value); resetPage(); }}
          className="text-sm font-medium border border-border rounded-lg px-3 py-2 bg-white text-slate-900 w-64"
        />
        <select
          aria-label="Filter by record type"
          value={tableFilter}
          onChange={(e) => { setTableFilter(e.target.value); resetPage(); }}
          className="text-sm font-medium border border-border rounded-lg px-3 py-2 bg-white text-slate-900"
        >
          <option value="all">All records</option>
          {Object.entries(TABLE_LABEL).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <select
          aria-label="Filter by action"
          value={actionFilter}
          onChange={(e) => { setActionFilter(e.target.value); resetPage(); }}
          className="text-sm font-medium border border-border rounded-lg px-3 py-2 bg-white text-slate-900"
        >
          <option value="all">All actions</option>
          {(Object.keys(ACTION_COPY) as AuditRow["action"][]).map((a) => (
            <option key={a} value={a}>{ACTION_COPY[a].label}</option>
          ))}
        </select>
        <input type="date" aria-label="From date" value={from}
          onChange={(e) => { setFrom(e.target.value); resetPage(); }}
          className="text-sm font-medium border border-border rounded-lg px-3 py-2 bg-white text-slate-900" />
        <input type="date" aria-label="To date" value={to}
          onChange={(e) => { setTo(e.target.value); resetPage(); }}
          className="text-sm font-medium border border-border rounded-lg px-3 py-2 bg-white text-slate-900" />
        <span className="text-sm text-muted-foreground font-medium ml-auto tabular-nums">
          {total} entries
        </span>
      </div>

      <Card className="bg-white rounded-xl overflow-hidden flex-1 min-h-0 flex flex-col">
        {error ? (
          <div className="p-12 text-center text-sm text-muted-foreground">
            Couldn't load the audit trail: {error}
          </div>
        ) : rows === undefined ? (
          <div className="p-12 flex justify-center">
            <div className="w-8 h-8 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
          </div>
        ) : rows.length === 0 ? (
          <div className="p-12 text-center flex flex-col items-center gap-3">
            <div className="w-14 h-14 rounded-full bg-slate-100 flex items-center justify-center">
              <History className="w-7 h-7 text-slate-400" />
            </div>
            <p className="text-muted-foreground font-bold">No entries match.</p>
          </div>
        ) : (
          <div className="overflow-auto flex-1">
            <table className="w-full text-left border-collapse">
              <thead className="sticky top-0 bg-white z-10 shadow-sm border-b border-border">
                <tr>
                  {["When", "Who", "Action", "Record", "Changes"].map((h) => (
                    <th key={h} className="py-3 px-6 text-[10px] font-extrabold tracking-wider text-slate-500 uppercase">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const open = expanded === r.id;
                  const action = ACTION_COPY[r.action];
                  const snapshot = r.action === "DELETE" ? r.old_row : r.new_row;
                  return (
                    <Fragment key={r.id}>
                      <tr
                        onClick={() => setExpanded(open ? null : r.id)}
                        className="border-b border-border hover:bg-slate-50 cursor-pointer"
                      >
                        <td className="py-3 px-6 text-sm text-slate-700 whitespace-nowrap tabular-nums">
                          {new Date(r.at).toLocaleString()}
                        </td>
                        <td className="py-3 px-6 text-sm">
                          <p className="font-medium text-slate-900 break-all">{whoLabel(r)}</p>
                          {r.actor_role && <p className="text-xs text-slate-500 capitalize">{r.actor_role.replace("_", " ")}</p>}
                        </td>
                        <td className="py-3 px-6">
                          <span className={`text-xs font-bold px-2 py-1 rounded-md ${action.tone}`}>{action.label}</span>
                        </td>
                        <td className="py-3 px-6 text-sm">
                          <p className="text-xs font-bold text-slate-500 uppercase">{TABLE_LABEL[r.table_name] ?? r.table_name}</p>
                          <p className="text-slate-900 font-medium">{r.row_label ?? r.row_id}</p>
                        </td>
                        <td className="py-3 px-6 text-sm text-slate-700">
                          {r.action === "UPDATE"
                            ? `${r.changed_fields.length} field${r.changed_fields.length === 1 ? "" : "s"}: ${r.changed_fields.join(", ")}`
                            : r.action === "INSERT" ? "New record" : "Record removed"}
                        </td>
                      </tr>
                      {open && (
                        <tr key={`${r.id}-detail`} className="bg-slate-50 border-b border-border">
                          <td colSpan={5} className="px-6 py-4">
                            <table className="text-sm w-full max-w-4xl">
                              <tbody>
                                {(r.action === "UPDATE" ? r.changed_fields : Object.keys(snapshot ?? {}))
                                  .filter((f) => !BULKY.has(f))
                                  .map((f) => (
                                    <tr key={f} className="align-top">
                                      <td className="py-1 pr-6 font-mono text-xs text-slate-500 whitespace-nowrap">{f}</td>
                                      {r.action === "UPDATE" ? (
                                        <>
                                          <td className="py-1 pr-4 text-rose-700 line-through break-all">{show(r.old_row?.[f])}</td>
                                          <td className="py-1 text-emerald-700 break-all">{show(r.new_row?.[f])}</td>
                                        </>
                                      ) : (
                                        <td className="py-1 text-slate-800 break-all" colSpan={2}>{show(snapshot?.[f])}</td>
                                      )}
                                    </tr>
                                  ))}
                              </tbody>
                            </table>
                            <p className="text-xs text-slate-500 mt-3 font-mono">
                              {r.table_name} · {r.row_id}
                            </p>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {pageCount > 1 && (
          <div className="border-t border-border p-3 flex-shrink-0">
            <PageStrip current={page} pageCount={pageCount} onPageChange={setPage} />
          </div>
        )}
      </Card>
    </div>
  );
}
