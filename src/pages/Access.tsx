import { useCallback, useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Check, ShieldCheck, UserCheck, UserCog, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/useAuth";
import { isoDatePart } from "@/lib/inspectionDates";

// [REF: WEB_ACCESS_PAGE]
//
// Admin-only. Two questions, one page, because they are the same question:
// who can see what.
//
//  1. Staff accounts — which role each account holds. This is the promotion
//     path the provisioning fix created a need for: handle_new_user() now
//     writes 'pending' instead of 'officer' (05_app_role_pending.sql), so a
//     new inspector cannot work until somebody here activates them. Without
//     this screen the security fix has no counterpart and new staff are stuck.
//
//  2. Point person requests — email addresses inspectors recorded in the
//     field, awaiting approval. Approving one creates the owner account,
//     grants it read access to that establishment, and records the address
//     that send-sanitary-order mails to.
//
// Everything here writes through RLS except the approval, which goes through
// the provision-owner function (creating an auth user needs the service-role
// key no client may hold).

type Role = "admin" | "department_head" | "officer" | "pending" | "owner";

interface ProfileRow {
  id: string;
  email: string | null;
  role: Role;
}

interface ProposalRow {
  logId: string;
  establishmentId: string;
  establishmentName: string;
  email: string;
  name: string | null;
  inspectionDate: string | null;
}

// PostgREST caps any response at 1000 rows, so an unpaged select silently
// truncates — and a truncated approval queue means access requests that simply
// vanish. Three of the reads below can outgrow that cap: `inspection_logs`
// accumulates one proposal row per recorded point person forever, the staff
// list grows with the office, and `establishment_contacts` holds a row per
// (owner, establishment) pair. The two keyed on a primary key cannot — see
// the note on the contacts read.
const PAGE = 1000;

// A ceiling, so a pathological dataset cannot spin here. Crossing it is
// REPORTED rather than silently obeyed (see `truncated` below): a queue that
// quietly stops at a round number reads as "nothing left to approve". Every
// read that can reach this ceiling feeds that flag.
const MAX_PAGES = 5;

/** Pages one filtered query to completion. `order("id")` is load-bearing for
 *  the same reason it is in lib/supabase.ts fetchAllRows: LIMIT/OFFSET over an
 *  unordered result is non-deterministic across separate requests, so
 *  concurrent writes can make rows skip or duplicate between pages. */
async function pageAll(
  build: (from: number, to: number) => any,
): Promise<{ rows: any[]; truncated: boolean }> {
  const rows: any[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * PAGE;
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) return { rows, truncated: false };
  }
  return { rows, truncated: true };
}

/** Splits an `.in()` filter into chunks a URL can carry. */
function chunk<T>(items: T[], size = 200): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// What this list can set, and what it deliberately cannot.
//
// 'admin' is out because promote_admin.py is the documented path for it, with
// its own log_action audit trail — and because keeping it out means a hijacked
// admin session cannot quietly mint a second administrator to survive the
// cleanup. Admins can still be demoted here, just not created.
//
// 'owner' is out because setting it here would grant nothing: an owner reads
// through establishment_contacts, and this list writes no grants. The account
// would hold a role whose label promises access it does not have. Owners are
// created by approving a request above, which writes the role and the grant
// together.
const ASSIGNABLE: Role[] = ["pending", "officer", "department_head"];

const ROLE_COPY: Record<Role, { label: string; hint: string; tone: string }> = {
  admin: {
    label: "Administrator",
    hint: "Full access, including the masterlist importer",
    tone: "text-violet-700 bg-violet-50",
  },
  department_head: {
    label: "Department head",
    hint: "Reads everything on this web portal, changes nothing",
    tone: "text-indigo-700 bg-indigo-50",
  },
  officer: {
    label: "Inspector",
    hint: "Records inspections in the mobile app; no web access",
    tone: "text-emerald-700 bg-emerald-50",
  },
  pending: {
    label: "Not activated",
    hint: "Signed up, cannot read anything yet",
    tone: "text-amber-700 bg-amber-50",
  },
  owner: {
    label: "Establishment owner",
    hint: "Reads only their own establishments, in the mobile app",
    tone: "text-sky-700 bg-sky-50",
  },
};

export function Access() {
  const { user } = useAuth();
  const [profiles, setProfiles] = useState<ProfileRow[] | null>(null);
  const [proposals, setProposals] = useState<ProposalRow[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      // Staff roles only. Owner accounts are not managed one by one here —
      // they are granted through the requests section above and revoked by
      // removing the grant — and there is one per establishment, which would
      // bury a dozen inspectors under thousands of rows (and overrun the
      // row cap while doing it).
      const staff = await pageAll((from, to) =>
        supabase
          .from("profiles")
          .select("id, email, role")
          .in("role", ["pending", "officer", "department_head", "admin"])
          .order("id")
          .range(from, to),
      );
      setProfiles(staff.rows as ProfileRow[]);

      // Every inspection that recorded a point person. Filtered server-side
      // (the partial index inspection_logs_proposed_contact_idx covers this
      // exact predicate) and paged, because the set only grows.
      //
      // Newest-dated first, NOT by id. This read cannot exclude requests that
      // were already granted or declined — that needs two other tables — so
      // resolved rows sit in the window alongside open ones and, as the table
      // ages, consume it. Ordered by a uuid the window was an arbitrary slice,
      // so once the set passed MAX_PAGES * PAGE a brand-new request had a
      // shrinking chance of being inside it: a hidden request, the one failure
      // this queue must not have. Newest-first makes a new request always
      // present, and pushes the loss onto the oldest resolved rows instead.
      //
      // `inspection_date` is not unique and can be null, so `id` is kept as
      // the tiebreaker — LIMIT/OFFSET over a non-unique sort can skip or
      // duplicate rows between pages. Undated rows go last rather than first
      // (Postgres puts NULLs first on DESC) so they cannot crowd the window.
      const proposed = await pageAll((from, to) =>
        supabase
          .from("inspection_logs")
          .select(
            "id, establishment_id, establishment_name, inspection_date, " +
              "proposed_point_person_name, proposed_point_person_email",
          )
          .not("proposed_point_person_email", "is", null)
          .order("inspection_date", { ascending: false, nullsFirst: false })
          .order("id")
          .range(from, to),
      );

      const logRows = (proposed.rows as any[]).filter(
        (r) => r.establishment_id && (r.proposed_point_person_email ?? "").trim(),
      );

      // The remaining two reads are keyed to what the proposals actually
      // reference, so they stay bounded by the queue rather than by the size
      // of the city.
      const estIds = [...new Set(logRows.map((r) => r.establishment_id as string))];
      const logIds = logRows.map((r) => r.id as string);

      // Paged inside each chunk, unlike the two reads below it. Those are
      // keyed on a primary key — owner_access_rejections.inspection_log_id and
      // profiles.id — so a 200-id chunk returns at most 200 rows and the cap
      // is unreachable. This one is keyed on establishment_id, half of a
      // (user_id, establishment_id) PK, so an establishment may hold many
      // contacts and 200 ids can exceed 1000 rows. A bare .in() would then
      // drop grants silently, and a missing grant makes an already-approved
      // request reappear here as open.
      const contacts: any[] = [];
      let contactsTruncated = false;
      for (const ids of chunk(estIds)) {
        const got = await pageAll((from, to) =>
          supabase
            .from("establishment_contacts")
            .select("user_id, establishment_id")
            .in("establishment_id", ids)
            .order("establishment_id")
            .order("user_id")
            .range(from, to),
        );
        contacts.push(...got.rows);
        contactsTruncated = contactsTruncated || got.truncated;
      }

      // Reported once, after every read that can hit the ceiling.
      setTruncated(staff.truncated || proposed.truncated || contactsTruncated);

      const declinedRows: any[] = [];
      for (const ids of chunk(logIds)) {
        const { data, error: e } = await supabase
          .from("owner_access_rejections")
          .select("inspection_log_id")
          .in("inspection_log_id", ids);
        if (e) throw new Error(e.message);
        declinedRows.push(...(data ?? []));
      }

      // Grant holders' addresses. profiles.id IS the auth uid, so this is the
      // only way to answer "does this email already hold a grant here?" —
      // establishment_contacts stores the uid, not the address.
      const contactUserIds = [...new Set(contacts.map((c) => c.user_id as string))];
      const emailById = new Map<string, string>();
      for (const ids of chunk(contactUserIds)) {
        const { data, error: e } = await supabase
          .from("profiles")
          .select("id, email")
          .in("id", ids);
        if (e) throw new Error(e.message);
        for (const row of data ?? []) {
          emailById.set(row.id as string, ((row.email as string) ?? "").toLowerCase());
        }
      }

      // Keyed on the (address, establishment) pair: one person can be the
      // point person for several establishments, and each needs approving on
      // its own.
      const granted = new Set(
        contacts.map((c) => `${emailById.get(c.user_id) ?? ""}::${c.establishment_id}`),
      );
      const declined = new Set(
        declinedRows.map((r) => r.inspection_log_id as string),
      );

      // Newest first, so the dedup below keeps the most recently recorded
      // address. The query already returns this order; sorting again keeps the
      // dedup's invariant local, so it survives a change to the query's
      // ordering without silently picking an older address.
      logRows.sort((a, b) =>
        String(b.inspection_date ?? "").localeCompare(String(a.inspection_date ?? "")),
      );

      const seen = new Set<string>();
      const open: ProposalRow[] = [];
      for (const row of logRows) {
        const email = (row.proposed_point_person_email ?? "").trim().toLowerCase();
        const pair = `${email}::${row.establishment_id}`;
        if (declined.has(row.id)) continue;
        if (granted.has(pair)) continue;
        // The same point person recorded on several inspections of the same
        // establishment is one decision, not one per visit.
        if (seen.has(pair)) continue;
        seen.add(pair);
        open.push({
          logId: row.id,
          establishmentId: row.establishment_id,
          establishmentName: row.establishment_name ?? "Unknown establishment",
          email,
          name: row.proposed_point_person_name ?? null,
          inspectionDate: row.inspection_date ?? null,
        });
      }
      setProposals(open);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const pendingCount = useMemo(
    () => (profiles ?? []).filter((p) => p.role === "pending").length,
    [profiles],
  );

  const changeRole = async (row: ProfileRow, next: Role) => {
    setBusyId(row.id);
    const { error: updateError } = await supabase
      .from("profiles")
      .update({ role: next })
      .eq("id", row.id);
    setBusyId(null);
    if (updateError) {
      toast.error(updateError.message);
      return;
    }
    toast.success(`${row.email ?? "Account"} is now ${ROLE_COPY[next].label.toLowerCase()}.`);
    load();
  };

  const approve = async (row: ProposalRow) => {
    setBusyId(row.logId);
    const { error: fnError } = await supabase.functions.invoke("provision-owner", {
      body: { logId: row.logId },
    });
    setBusyId(null);
    if (fnError) {
      // The SDK reports a non-2xx as a generic FunctionsHttpError; the
      // function's own message ("already belongs to a staff account") is the
      // only version worth showing.
      let message = fnError.message;
      try {
        const body = await (fnError as { context?: Response }).context?.json();
        if (body?.error) message = body.error;
      } catch {
        /* not JSON — the generic message stands */
      }
      toast.error(message);
      return;
    }
    toast.success(`${row.email} can now view ${row.establishmentName}.`);
    load();
  };

  const decline = async (row: ProposalRow) => {
    setBusyId(row.logId);
    const { error: insertError } = await supabase
      .from("owner_access_rejections")
      .upsert({ inspection_log_id: row.logId, decided_by: user?.id ?? null });
    setBusyId(null);
    if (insertError) {
      toast.error(insertError.message);
      return;
    }
    toast.success("Request declined.");
    load();
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Access</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Who can sign in, and whose records they can see.
        </p>
      </div>

      {error && (
        <Card className="p-4 border-red-200 bg-red-50">
          <p className="text-sm text-red-700">Could not load access data: {error}</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={load}>
            Retry
          </Button>
        </Card>
      )}

      {truncated && (
        <Card className="p-4 border-amber-200 bg-amber-50">
          <p className="text-sm text-amber-800">
            There are more records than this page loads at once, so some requests
            or accounts may not be listed. Approve or decline what is shown and
            reload.
          </p>
        </Card>
      )}

      {/* ── Point person requests ──────────────────────────────────────── */}
      <Card className="p-5">
        <div className="flex items-center gap-2 mb-1">
          <UserCheck className="w-4 h-4 text-primary" />
          <h2 className="font-bold text-slate-900">Point person requests</h2>
          {proposals && proposals.length > 0 && (
            <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700">
              {proposals.length} waiting
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground mb-4">
          Email addresses inspectors recorded during an inspection. Approving one
          creates the owner's account, lets them read that establishment's records
          in the mobile app, and sets the address Sanitary Order copies are sent to.
        </p>

        {proposals === null ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : proposals.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing waiting. Requests appear here when an inspector records a point
            person's email on an inspection.
          </p>
        ) : (
          <div className="space-y-2">
            {proposals.map((row) => (
              <div
                key={row.logId}
                className="flex flex-wrap items-center gap-3 p-3 rounded-lg border border-border"
              >
                <div className="flex-1 min-w-[12rem]">
                  <p className="text-sm font-semibold text-slate-900 break-all">
                    {row.email}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {row.name ? `${row.name} · ` : ""}
                    {row.establishmentName}
                    {row.inspectionDate ? ` · ${isoDatePart(row.inspectionDate)}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    disabled={busyId === row.logId}
                    onClick={() => approve(row)}
                  >
                    <Check className="w-4 h-4 mr-1.5" />
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busyId === row.logId}
                    onClick={() => decline(row)}
                  >
                    <X className="w-4 h-4 mr-1.5" />
                    Decline
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* ── Staff accounts ─────────────────────────────────────────────── */}
      <Card className="p-5">
        <div className="flex items-center gap-2 mb-1">
          <UserCog className="w-4 h-4 text-primary" />
          <h2 className="font-bold text-slate-900">Accounts</h2>
          {pendingCount > 0 && (
            <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700">
              {pendingCount} not activated
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground mb-4">
          A new sign-up starts as <strong>Not activated</strong> and can read nothing
          until you make them an Inspector. Administrators are granted with{" "}
          <code className="text-[11px]">promote_admin.py</code>, not from here.
        </p>

        {profiles === null ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <div className="space-y-2">
            {profiles.map((row) => {
              const copy = ROLE_COPY[row.role] ?? ROLE_COPY.pending;
              // An admin changing their own role is how a project ends up with
              // no administrator at all — and nobody able to appoint one,
              // since promote_admin.py needs a machine with the PAT on it.
              const isSelf = row.id === user?.id;
              return (
                <div
                  key={row.id}
                  className="flex flex-wrap items-center gap-3 p-3 rounded-lg border border-border"
                >
                  <div className="flex-1 min-w-[12rem]">
                    <p className="text-sm font-semibold text-slate-900 break-all">
                      {row.email ?? "No email on record"}
                      {isSelf && (
                        <span className="ml-2 text-[11px] font-bold text-muted-foreground">
                          you
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">{copy.hint}</p>
                  </div>
                  <span
                    className={`text-[11px] font-bold px-2 py-1 rounded-full ${copy.tone}`}
                  >
                    {copy.label}
                  </span>
                  {isSelf ? (
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground px-2">
                      <ShieldCheck className="w-3.5 h-3.5" />
                      Your own role is locked
                    </span>
                  ) : (
                    <Select
                      value={ASSIGNABLE.includes(row.role) ? row.role : undefined}
                      onValueChange={(v) => changeRole(row, v as Role)}
                      disabled={busyId === row.id}
                    >
                      <SelectTrigger className="w-[11rem]">
                        <SelectValue placeholder="Change role" />
                      </SelectTrigger>
                      <SelectContent>
                        {ASSIGNABLE.map((r) => (
                          <SelectItem key={r} value={r}>
                            {ROLE_COPY[r].label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
