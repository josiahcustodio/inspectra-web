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
import { ShieldCheck, UserCog } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/useAuth";

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
//  2. Owner accounts are not managed here. A point person an inspector
//     records on an inspection becomes an owner automatically
//     (10_auto_owner.sql), so there is nothing to approve.

type Role = "admin" | "department_head" | "officer" | "pending" | "owner";

interface ProfileRow {
  id: string;
  email: string | null;
  role: Role;
}

// PostgREST caps any response at 1000 rows, so an unpaged select silently
// truncates, and the staff list grows with the office.
const PAGE = 1000;

// A ceiling, so a pathological dataset cannot spin here. Crossing it is
// REPORTED rather than silently obeyed (see `truncated` below).
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
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      // Staff roles only: there is one owner per establishment, which would
      // bury a dozen inspectors under thousands of rows.
      const staff = await pageAll((from, to) =>
        supabase
          .from("profiles")
          .select("id, email, role")
          .in("role", ["pending", "officer", "department_head", "admin"])
          .order("id")
          .range(from, to),
      );
      setProfiles(staff.rows as ProfileRow[]);

      setTruncated(staff.truncated);
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
            There are more accounts than this page loads at once, so some may
            not be listed.
          </p>
        </Card>
      )}

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
