import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { ShieldCheck, MailCheck } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";
import { useAuth } from "@/lib/useAuth";

const RESEND_COOLDOWN_SECONDS = 30;

// Two ways to land here, and only one of them has a session:
//  - fresh signup: Supabase keeps the account parked (NO session) until the
//    verification link is clicked — the email to show arrives in router
//    state from Signup/Login instead of from the auth user;
//  - a signed-in-but-unverified session (rare: only possible if email
//    confirmation was ever toggled off), where the old Firebase-era flow
//    with refreshUser still applies.
// The verification link itself signs the user in (it redirects back to the
// app with tokens), so the normal exit from this page is Supabase's redirect,
// not the buttons below.
export function VerifyEmail() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, session, emailVerified, isLoading, refreshUser } = useAuth();
  const [isChecking, setIsChecking] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const cooldownTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const email: string | null = user?.email ?? (location.state as any)?.email ?? null;

  // Stop the resend-cooldown ticker if the page unmounts mid-countdown,
  // so it doesn't keep firing setState on an unmounted component.
  useEffect(() => {
    return () => {
      if (cooldownTimer.current) clearInterval(cooldownTimer.current);
    };
  }, []);

  // No session AND no email to work with — nothing to render; go sign in.
  useEffect(() => {
    if (!isLoading && !session && !email) navigate("/login", { replace: true });
  }, [isLoading, session, email, navigate]);

  useEffect(() => {
    if (session && emailVerified) navigate("/", { replace: true });
  }, [session, emailVerified, navigate]);

  if ((!isLoading && !session && !email) || (session && emailVerified)) return null;

  const handleResend = async () => {
    if (!email || cooldown > 0) return;
    try {
      const { error } = await supabase.auth.resend({
        type: "signup",
        email,
        options: { emailRedirectTo: window.location.origin },
      });
      if (error) throw error;
      toast.success("Verification email sent");
      setCooldown(RESEND_COOLDOWN_SECONDS);
      if (cooldownTimer.current) clearInterval(cooldownTimer.current);
      cooldownTimer.current = setInterval(() => {
        setCooldown((prev) => {
          if (prev <= 1) {
            if (cooldownTimer.current) clearInterval(cooldownTimer.current);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } catch (err: any) {
      toast.error(err.message || "Failed to resend email");
    }
  };

  // [REF: EMAIL_VERIFICATION_CHECK]
  // With a session: ask the auth server for the fresh user (the cached one
  // predates the click on the link). Without one: the link signs the user in
  // on its own tab — from here the path is simply signing in again.
  const handleCheckVerified = async () => {
    setIsChecking(true);
    try {
      if (session) {
        await refreshUser();
        const { data } = await supabase.auth.getUser();
        if (data.user?.email_confirmed_at) {
          toast.success("Email verified");
          navigate("/", { replace: true });
        } else {
          toast.info("Still not verified. Check your inbox and click the link.");
        }
      } else {
        navigate("/login", { replace: true });
      }
    } finally {
      setIsChecking(false);
    }
  };

  const handleSignOut = async () => {
    if (session) await supabase.auth.signOut();
    navigate("/login", { replace: true });
  };

  return (
    <div className="min-h-screen w-full bg-slate-50 flex flex-col items-center justify-center p-8">
      <div className="w-full max-w-sm space-y-6 text-center">
        <div className="flex items-center justify-center gap-2 text-primary">
          <ShieldCheck className="w-6 h-6" />
          <span className="font-bold text-xl tracking-tight">Inspectra</span>
        </div>

        <div className="mx-auto w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
          <MailCheck className="w-8 h-8 text-primary" />
        </div>

        <div className="space-y-2">
          <h2 className="text-2xl font-bold tracking-tight text-slate-900">Verify your email</h2>
          <p className="text-slate-500">
            We sent a verification link to{" "}
            <span className="font-medium text-slate-900">{email}</span>. Clicking it signs you
            in automatically{session ? " — or check below once you have" : ""}.
          </p>
        </div>

        <div className="space-y-3 pt-2">
          <Button
            className="w-full h-12 bg-primary hover:bg-primary/90 text-primary-foreground"
            onClick={handleCheckVerified}
            disabled={isChecking}
          >
            {isChecking ? "Checking..." : session ? "I've verified — Continue" : "Go to sign in"}
          </Button>
          <Button
            variant="outline"
            className="w-full h-12 border-slate-200"
            onClick={handleResend}
            disabled={cooldown > 0}
          >
            {cooldown > 0 ? `Resend email (${cooldown}s)` : "Resend email"}
          </Button>
          <button
            type="button"
            onClick={handleSignOut}
            className="text-sm text-slate-500 hover:text-slate-700 hover:underline"
          >
            {session ? "Sign out" : "Back to sign in"}
          </button>
        </div>
      </div>
    </div>
  );
}
