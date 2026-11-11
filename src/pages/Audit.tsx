import { Fragment, useEffect, useMemo, useState } from "react";
import { Download, History, RefreshCw } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageStrip } from "@/components/PageStrip";
import { supabase } from "@/lib/supabase";
import { useCollection } from "@/lib/useCollection";
import { COLLECTIONS, mapEstablishment, mapProfile } from "@/lib/dataAccess";
import { saveWorkbook } from "@/lib/masterlistExport";
import { logEvent } from "@/lib/auditEvents";
import { toast } from "sonner";

// [REF: AUDIT_TRAIL_PAGE]
// Reads public.audit_log, which only the audit_row() trigger and log_event()
// write (migration/sql/09_audit_trail.sql, 12_audit_events.sql). Admin-only
// in RLS and in the route map. Server-side paging on purpose: the table grows
// for the life of the project, so unlike every other list this one is never
// read whole or kept live.
//
// The page is a logbook, not a database view: one plain sentence per entry
// (who, when, what happened), and for an edit the before and after of the
// fields a person would recognise. Internal columns never show. The full
// row snapshots stay in the table for anyone who needs the raw record.

interface AuditRow {
  id: number;
  at: string;
  actor_id: string | null;
  actor_email: string | null;
  actor_role: string | null;
  table_name: string;
  row_id: string;
  row_label: string | null;
  action: "INSERT" | "UPDATE" | "DELETE" | "SIGN_IN" | "EXPORT" | "REPORT";
  changed_fields: string[];
  old_row: Record<string, unknown> | null;
  new_row: Record<string, unknown> | null;
}

const PAGE_SIZE = 25;
const EXPORT_CAP = 5000;

// The type dropdown, in the reader's words. Each maps to the tables behind it.
const TYPES: { key: string; label: string; tables: string[] }[] = [
  { key: "inspections", label: "Inspections & sanitary orders", tables: ["inspection_logs"] },
  { key: "establishments", label: "Establishments", tables: ["establishments", "establishment_permits"] },
  { key: "accounts", label: "Accounts & roles", tables: ["profiles"] },
  { key: "access", label: "Owner access", tables: ["establishment_contacts", "owner_access_rejections"] },
  { key: "inspectors", label: "Inspectors", tables: ["inspectors"] },
  { key: "checklists", label: "Checklists", tables: ["checklist_templates", "categories"] },
  { key: "events", label: "Sign-ins, exports & reports", tables: ["events"] },
];

const ROLE_LABEL: Record<string, string> = {
  admin: "Administrator",
  department_head: "Department head",
  officer: "Inspector",
  pending: "Not activated",
  owner: "Establishment owner",
};

// Field names as the forms label them. Anything not listed is shown with its
// underscores turned into spaces, so a new column still reads as words.
const FIELD_LABEL: Record<string, string> = {
  business_name: "Business name",
  owner_name: "Owner",
  address: "Address",
  barangay: "Barangay",
  business_permit_no: "Permit no.",
  line_of_business: "Line of business",
  point_person_name: "Point person",
  point_person_email: "Point person email",
  role: "Role",
  email: "Email",
  name: "Name",
  inspector_name: "Inspector",
  inspection_date: "Inspection date",
  percentage_rating: "Rating",
  total_demerits: "Demerits",
  remarks: "Remarks",
  category_name: "Category",
  so_no: "Sanitary order no.",
  so_issued_at: "Sanitary order issued",
  time_given: "Time given",
  deadline: "Deadline",
  received_by_name: "Received by",
  email_sent_at: "Order emailed",
  status: "Status",
  performance: "Performance",
  item_name: "Checklist item",
  weight: "Weight",
};

// Internal or bulky columns: ids, hashes, sync bookkeeping, signatures,
// coordinates and the raw checklist answers. Never shown in the before/after.
const HIDDEN = /(^id$|_id$|_url$|_sha256$|^created_at$|^updated_at$|^synced|^results$|^coordinates$|^photo_|^signature|^received_signature|^proposed_)/;

const fieldLabel = (f: string) => FIELD_LABEL[f] ?? f.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
const roleLabel = (r: string | null | undefined) => (r ? ROLE_LABEL[r] ?? r : "");

function show(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "string") {
    // Timestamps read as local date and time; a bare date stays a date.
    if (/^\d{4}-\d{2}-\d{2}T/.test(v)) return new Date(v).toLocaleString();
    return v.length > 160 ? v.slice(0, 157) + "…" : v;
  }
  if (typeof v === "number") return String(v);
  const s = JSON.stringify(v);
  return s.length > 160 ? s.slice(0, 157) + "…" : s;
}

function who(r: AuditRow): { name: string; role: string } {
  if (r.actor_email) return { name: r.actor_email, role: roleLabel(r.actor_role) };
  // No actor: the auth trigger, a migration, or a script. Say so plainly.
  return { name: "Automatic", role: r.actor_id ? "Unknown account" : "System" };
}

/** The one-sentence description of an entry. `names` resolves the ids an
 *  owner-access row carries into an email and an establishment name. */
function describe(r: AuditRow, names: { est: (id: unknown) => string; user: (id: unknown) => string }): string {
  const label = r.row_label ?? "a record";
  const changed = new Set(r.changed_fields);
  switch (r.table_name) {
    case "events":
      if (r.action === "SIGN_IN") return r.row_label ?? "Signed in to the portal";
      if (r.action === "EXPORT") return `Exported ${r.row_label ?? "a file"}`;
      return `Generated ${r.row_label ?? "a report"}`;
    case "inspection_logs": {
      if (r.action === "INSERT") {
        const rating = r.new_row?.percentage_rating;
        return `Recorded an inspection of ${label}${typeof rating === "number" ? `, rated ${rating}%` : ""}`;
      }
      if (r.action === "DELETE") return `Deleted the inspection of ${label}`;
      if (changed.has("email_sent_at")) return `Emailed the sanitary order for ${label} to its point person`;
      if (changed.has("so_issued_at") || changed.has("so_no")) return `Issued a sanitary order for ${label}`;
      if (changed.has("received_by_name") || changed.has("received_signature_url")) return `Recorded receipt of the sanitary order for ${label}`;
      if (changed.has("proposed_point_person_email")) return `Recorded a point person for ${label}`;
      return `Edited the inspection of ${label}`;
    }
    case "establishments":
      return r.action === "INSERT" ? `Added establishment ${label}`
        : r.action === "DELETE" ? `Removed establishment ${label}`
        : changed.has("point_person_email") ? `Set the point person of ${label}`
        : `Edited establishment ${label}`;
    case "establishment_permits":
      return r.action === "INSERT" ? `Added a permit for ${label}`
        : r.action === "DELETE" ? `Removed a permit for ${label}` : `Edited a permit for ${label}`;
    case "profiles": {
      if (r.action === "INSERT") return `New account created: ${label}`;
      if (r.action === "DELETE") return `Deleted the account ${label}`;
      if (changed.has("role")) {
        return `Changed the role of ${label} from ${roleLabel(r.old_row?.role as string) || "none"} to ${roleLabel(r.new_row?.role as string) || "none"}`;
      }
      return `Edited the account ${label}`;
    }
    case "establishment_contacts": {
      const row = r.new_row ?? r.old_row;
      const owner = names.user(row?.user_id);
      const est = names.est(row?.establishment_id);
      return r.action === "DELETE" ? `Removed ${owner}'s access to ${est}` : `Gave ${owner} access to ${est}`;
    }
    case "owner_access_rejections":
      return "Declined a point person request";
    case "inspectors":
      return r.action === "INSERT" ? `Added inspector ${label} to the directory`
        : r.action === "DELETE" ? `Removed inspector ${label} from the directory` : `Edited inspector ${label}`;
    case "checklist_templates":
      return r.action === "INSERT" ? `Added checklist item "${label}"`
        : r.action === "DELETE" ? `Removed checklist item "${label}"` : `Edited checklist item "${label}"`;
    case "categories":
      return r.action === "INSERT" ? `Added category ${label}`
        : r.action === "DELETE" ? `Removed category ${label}` : `Edited category ${label}`;
    default:
      return `${r.action === "INSERT" ? "Added" : r.action === "DELETE" ? "Removed" : "Edited"} ${label}`;
  }
}

/** Before/after pairs worth showing for an entry, if any. */
function changes(r: AuditRow): { field: string; before: string; after: string }[] {
  if (r.action !== "UPDATE") return [];
  return r.changed_fields
    .filter((f) => !HIDDEN.test(f))
    .map((f) => ({ field: fieldLabel(f), before: show(r.old_row?.[f]), after: show(r.new_row?.[f]) }));
}

export function Audit() {
  const [page, setPage] = useState(1);
  const [typeFilter, setTypeFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [rows, setRows] = useState<AuditRow[] | undefined>(undefined);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [fetching, setFetching] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Owner-access rows carry only ids; these two (cached) tables turn them
  // into an email and an establishment name.
  const { data: establishments } = useCollection(COLLECTIONS.establishments, mapEstablishment);
  const { data: profiles } = useCollection(COLLECTIONS.profiles, mapProfile);
  const names = useMemo(() => {
    const est = new Map((establishments ?? []).map((e) => [e.id, e.business_name] as const));
    const user = new Map((profiles ?? []).map((p) => [p.id, p.email] as const));
    return {
      est: (id: unknown) => (typeof id === "string" && est.get(id)) || "an establishment",
      user: (id: unknown) => (typeof id === "string" && user.get(id)) || "an owner",
    };
  }, [establishments, profiles]);

  // One query shape for the page and the export; only the range differs.
  const buildQuery = (start: number, end: number) => {
    let q = supabase
      .from("audit_log")
      .select("*", { count: "exact" })
      .order("at", { ascending: false })
      .range(start, end);
    const type = TYPES.find((t) => t.key === typeFilter);
    if (type) q = q.in("table_name", type.tables);
    // "T00:00" makes the picker's date parse as LOCAL midnight; a bare
    // YYYY-MM-DD parses as UTC and would start the day at 08:00 here.
    if (from) q = q.gte("at", new Date(`${from}T00:00`).toISOString());
    if (to) q = q.lt("at", new Date(new Date(`${to}T00:00`).getTime() + 86_400_000).toISOString());
    // PostgREST's or() filter uses , ( ) as syntax; strip them so a typed
    // search can't change the query's shape.
    const term = search.trim().replace(/[,()]/g, "");
    if (term) q = q.or(`actor_email.ilike.%${term}%,row_label.ilike.%${term}%`);
    return q;
  };

  useEffect(() => {
    let cancelled = false;
    setFetching(true);
    const start = (page - 1) * PAGE_SIZE;
    buildQuery(start, start + PAGE_SIZE - 1).then(({ data, count, error }) => {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, typeFilter, search, from, to, reloadKey]);

  // [REF: AUDIT_EXPORT]
  // The filtered trail as a spreadsheet, newest first, capped so a runaway
  // range cannot pull the whole history into the browser. The export itself
  // is an audit event.
  const exportTrail = async () => {
    setExporting(true);
    try {
      const all: AuditRow[] = [];
      for (let start = 0; start < EXPORT_CAP; start += 1000) {
        const { data, error } = await buildQuery(start, Math.min(start + 999, EXPORT_CAP - 1));
        if (error) throw new Error(error.message);
        all.push(...((data ?? []) as AuditRow[]));
        if (!data || data.length < 1000) break;
      }
      const ExcelJS = await import("exceljs");
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet("Audit trail");
      sheet.addRow(["When", "Who", "Role", "What happened", "Changes"]);
      sheet.getRow(1).font = { bold: true };
      for (const r of all) {
        const w = who(r);
        sheet.addRow([
          new Date(r.at).toLocaleString(),
          w.name,
          w.role,
          describe(r, names),
          changes(r).map((c) => `${c.field}: ${c.before} → ${c.after}`).join("\n"),
        ]);
      }
      sheet.columns = [{ width: 22 }, { width: 32 }, { width: 18 }, { width: 70 }, { width: 60 }];
      const stamp = new Date().toISOString().slice(0, 10);
      saveWorkbook(await workbook.xlsx.writeBuffer(), `audit-trail-${from || "start"}-to-${to || stamp}.xlsx`);
      logEvent("EXPORT", `Audit trail to Excel, ${all.length} entries${from || to ? ` (${from || "start"} to ${to || "today"})` : ""}`);
      toast.success(`Exported ${all.length} entries${all.length >= EXPORT_CAP ? " (capped — narrow the dates for the rest)" : ""}.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not build the file.");
    } finally {
      setExporting(false);
    }
  };

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const resetPage = () => setPage(1);

  return (
    <div className="flex flex-col h-full gap-6">
      <div className="flex items-center justify-between flex-wrap gap-3 flex-shrink-0">
        <div>
          <h2 className="font-bold text-slate-900 text-2xl tracking-tight">Audit Trail</h2>
          <p className="text-muted-foreground mt-1 text-sm font-medium">
            Who did what, and when. Written by the system on every action; nobody can edit or delete it.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" disabled={fetching} onClick={() => setReloadKey((k) => k + 1)}>
            <RefreshCw className={`w-4 h-4 mr-2 ${fetching ? "animate-spin" : ""}`} />
            {fetching ? "Refreshing…" : "Refresh"}
          </Button>
          <Button
            onClick={() => void exportTrail()}
            disabled={exporting || total === 0}
            className="bg-primary hover:bg-primary/90 text-primary-foreground font-bold shadow-sm"
          >
            <Download className="w-4 h-4 mr-2" />
            {exporting ? "Building file…" : "Export to Excel"}
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-3 flex-wrap flex-shrink-0">
        <input
          type="search"
          aria-label="Search by person or record"
          placeholder="Search person or record…"
          value={search}
          onChange={(e) => { setSearch(e.target.value); resetPage(); }}
          className="text-sm font-medium border border-border rounded-lg px-3 py-2 bg-white text-slate-900 w-64"
        />
        <select
          aria-label="Filter by type"
          value={typeFilter}
          onChange={(e) => { setTypeFilter(e.target.value); resetPage(); }}
          className="text-sm font-medium border border-border rounded-lg px-3 py-2 bg-white text-slate-900"
        >
          <option value="all">Everything</option>
          {TYPES.map((t) => (
            <option key={t.key} value={t.key}>{t.label}</option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm font-medium text-slate-600">
          From
          <input type="date" value={from} max={to || undefined}
            onChange={(e) => { setFrom(e.target.value); resetPage(); }}
            className="text-sm font-medium border border-border rounded-lg px-3 py-2 bg-white text-slate-900" />
        </label>
        <label className="flex items-center gap-2 text-sm font-medium text-slate-600">
          To
          <input type="date" value={to} min={from || undefined}
            onChange={(e) => { setTo(e.target.value); resetPage(); }}
            className="text-sm font-medium border border-border rounded-lg px-3 py-2 bg-white text-slate-900" />
        </label>
        <span className="text-sm text-muted-foreground font-medium ml-auto tabular-nums">
          {total} entr{total === 1 ? "y" : "ies"}
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
                  {["When", "Who", "What happened"].map((h) => (
                    <th key={h} className="py-3 px-6 text-[10px] font-extrabold tracking-wider text-slate-500 uppercase">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const open = expanded === r.id;
                  const diff = changes(r);
                  const w = who(r);
                  return (
                    <Fragment key={r.id}>
                      <tr
                        onClick={() => diff.length && setExpanded(open ? null : r.id)}
                        className={`border-b border-border ${diff.length ? "hover:bg-slate-50 cursor-pointer" : ""}`}
                      >
                        <td className="py-3 px-6 text-sm text-slate-700 whitespace-nowrap tabular-nums align-top">
                          {new Date(r.at).toLocaleString()}
                        </td>
                        <td className="py-3 px-6 text-sm align-top">
                          <p className={`font-medium break-all ${w.name === "Automatic" ? "text-slate-500 italic" : "text-slate-900"}`}>{w.name}</p>
                          {w.role && <p className="text-xs text-slate-500">{w.role}</p>}
                        </td>
                        <td className="py-3 px-6 text-sm text-slate-900 align-top">
                          {describe(r, names)}
                          {diff.length > 0 && (
                            <span className="ml-2 text-xs font-bold text-primary">{open ? "Hide changes" : "Show changes"}</span>
                          )}
                        </td>
                      </tr>
                      {open && (
                        <tr className="bg-slate-50 border-b border-border">
                          <td colSpan={3} className="px-6 py-4">
                            <table className="text-sm">
                              <tbody>
                                {diff.map((c) => (
                                  <tr key={c.field} className="align-top">
                                    <td className="py-1 pr-6 font-bold text-slate-600 whitespace-nowrap">{c.field}</td>
                                    <td className="py-1 pr-4 text-rose-700 line-through break-all">{c.before}</td>
                                    <td className="py-1 text-emerald-700 break-all">{c.after}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
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
