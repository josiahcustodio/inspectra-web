import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { Clock, Smartphone, LogOut, RefreshCw } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/useAuth";

// [REF: WEB_ACCOUNT_STATUS]
//
// The landing place for the two roles that have no staff portal.
//
// It exists because of the provisioning fix, not alongside it. New accounts
// used to be stamped 'officer' by handle_new_user() and dropped straight into
// the dashboard — the hole 05_app_role_pending.sql closes. A new account is
// now 'pending', and RoleRedirect only ever knew 'admin' and 'officer', so
// without this page the fix would land every new signup on an infinite
// spinner: a signed-in session, a real role, and no route that matches it.
//
//  * pending — created, not yet activated by an administrator. Every policy in
//    02_rls.sql denies the role, so there is no page here with anything on it.
//  * owner — an establishment's point person. Their records exist and they are
//    allowed to read them, but the owner UI is in the mobile app; this is the
//    staff portal and has no owner-facing screen. Saying so beats a dashboard
//    of empty tables.
export function AccountStatus() {
  const navigate = useNavigate();
  const { user, session, isLoading, role, retryProfile } = useAuth();
  const [checking, setChecking] = useState(false);

  // [REF: ACCOUNT_STATUS_SESSION]
  // This route sits outside both AuthGuard branches deliberately — the roles
  // that land here match neither, and guarding it would bounce them back to
  // "/" in a loop. That also left it open to anyone, who saw "Waiting for
  // activation / Signed in as Unknown account": a page describing an account
  // state for a visitor with no account at all. A session test keeps the
  // loop-avoidance without the fiction.
  useEffect(() => {
    if (!isLoading && !session) navigate("/login", { replace: true });
  }, [isLoading, session, navigate]);

  // Activation happens on an administrator's screen, so the role can change
  // under a session already parked here — via "Check again" below, or a token
  // refresh. This route sits outside the "/" subtree, so RoleRedirect never
  // sees that change; without this effect an activated account stays on the
  // waiting page until it reloads by hand.
  //
  // Navigating to "/" rather than to a dashboard keeps RoleRedirect the only
  // role-to-route map there is: it also owns the MFA and email-verification
  // branches, which a direct jump from here would skip.
  useEffect(() => {
    if (role === "admin" || role === "officer") navigate("/", { replace: true });
  }, [role, navigate]);

  if (isLoading || !session) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="w-8 h-8 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  const isOwner = role === "owner";

  const handleCheckAgain = async () => {
    setChecking(true);
    await retryProfile();
    setChecking(false);
    // No navigate() here: retryProfile updates the role in context and the
    // effect above acts on it. Deciding again in this handler would duplicate
    // that rule off a `role` this closure captured before the refetch.
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate("/login", { replace: true });
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4 py-12">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-2xl border border-border shadow-sm p-8">
          <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center mb-6">
            {isOwner ? (
              <Smartphone className="w-7 h-7 text-primary" />
            ) : (
              <Clock className="w-7 h-7 text-primary" />
            )}
          </div>

          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
            {isOwner ? "Use the Inspectra app" : "Waiting for activation"}
          </h1>

          <p className="text-sm text-slate-600 mt-3 leading-relaxed">
            {isOwner
              ? "This is the City Health Office staff portal. Your establishment's " +
                "inspection results and any Sanitary Order are in the Inspectra " +
                "mobile app — sign in there with this same email address and the " +
                "code it sends you."
              : "Your account was created, but an administrator at the City Health " +
                "Office still has to activate it before you can use the portal."}
          </p>

          <div className="mt-6 rounded-xl border border-border bg-slate-50 p-4">
            <p className="text-[11px] font-bold tracking-wide text-slate-500 uppercase">
              Signed in as
            </p>
            <p className="text-sm font-semibold text-slate-900 mt-1 break-all">
              {user?.email ?? "Unknown account"}
            </p>
            {!isOwner && (
              <p className="text-xs text-slate-500 mt-2 leading-relaxed">
                Give this address to your administrator — it is what they activate.
              </p>
            )}
          </div>

          <div className="mt-6 space-y-2">
            {/* Manual, not polled. An activation happens on someone else's
                screen minutes or hours later, and a background poll would run
                for every waiting account to save one click. */}
            {!isOwner && (
              <Button
                className="w-full"
                onClick={handleCheckAgain}
                disabled={checking}
              >
                <RefreshCw
                  className={`w-4 h-4 mr-2 ${checking ? "animate-spin" : ""}`}
                />
                {checking ? "Checking…" : "Check again"}
              </Button>
            )}
            <Button variant="outline" className="w-full" onClick={handleSignOut}>
              <LogOut className="w-4 h-4 mr-2" />
              Sign out
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
