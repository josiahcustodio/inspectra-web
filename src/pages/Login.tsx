import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ShieldCheck, ShieldQuestion } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { challengeAndVerifyTotp } from "@/lib/totp";
import { toast } from "sonner";
import { useAuth } from "@/lib/useAuth";

// shortcut: placeholder legal copy written by the dev team, replace with the CHO's reviewed text before public rollout.
const LEGAL = {
  privacy: {
    title: "Privacy Policy",
    body: [
      "Inspectra is operated by the Batangas City Health Office (CHO) to record sanitary inspections of business establishments.",
      "What we collect: your account email, name and role; inspection records you create (establishment details, checklist answers, scores and the names on each record); and an audit trail of changes made under your account.",
      "Why: to issue and track sanitary permits and sanitary orders, and to keep an accountable record of every inspection, as required of the CHO under P.D. 856 (Code on Sanitation of the Philippines).",
      "Who sees it: CHO administrators and inspectors with an issued account. Sanitary order copies are emailed only to the establishment's point person.",
      "Retention: inspection records are kept as official CHO records. Accounts are removed by the administrator when access ends.",
      "Your rights under the Data Privacy Act of 2012 (R.A. 10173): you may ask the CHO to view or correct the personal data held about you.",
    ],
  },
  terms: {
    title: "Terms and Conditions",
    body: [
      "Accounts are issued by the CHO administrator. Do not share your password or authenticator codes, and sign out on shared devices.",
      "Use Inspectra only for official CHO sanitary inspection work. Every record you create or change is written to a tamper-proof audit trail under your account.",
      "Inspection results, scores and sanitary orders are official CHO documents. Enter only what you observed on site.",
      "The CHO may suspend or remove an account that is misused. Misuse of official records is subject to the applicable civil service and criminal laws.",
    ],
  },
} as const;

export function Login() {
  const navigate = useNavigate();
  const { session, needsMfa } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [mfaCode, setMfaCode] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [legal, setLegal] = useState<keyof typeof LEGAL | null>(null);
  const legalLink = (key: keyof typeof LEGAL, label: string, className: string) => (
    <button type="button" onClick={() => setLegal(key)} className={className}>{label}</button>
  );

  // A fully-signed-in session means this page was reached by typing /login
  // while signed in. Redirect, and return null on the way out so the form
  // never flashes. A session that still owes its second factor stays here —
  // that is the OTP pane below (Supabase signs in at AAL1 first; the account
  // data stays server-blocked until the code upgrades the session to AAL2).
  useEffect(() => {
    if (session && !needsMfa) navigate("/", { replace: true });
  }, [session, needsMfa, navigate]);

  if (session && !needsMfa) return null;

  // [REF: WEB_SIGNIN_EMAIL]
  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;

    setIsLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      // If this account has a TOTP factor, useAuth flips needsMfa and this
      // page re-renders into the OTP pane; otherwise the guard redirects home.
      toast.success("Successfully logged in");
    } catch (err: any) {
      if (/email not confirmed/i.test(err.message ?? "")) {
        // Parked account: registered but never clicked the verification link.
        navigate("/verify-email", { replace: true, state: { email } });
      } else {
        toast.error(err.message || "Failed to log in");
      }
    } finally {
      setIsLoading(false);
    }
  };

  // [REF: WEB_MFA_CHALLENGE]
  // The session already exists (AAL1); verifying the TOTP code upgrades it to
  // AAL2, which is what the restrictive RLS policies are waiting for.
  const handleMfaSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mfaCode.length !== 6) return;

    setIsLoading(true);
    try {
      const { data: factorData, error: listError } = await supabase.auth.mfa.listFactors();
      if (listError) throw listError;
      // listFactors().totp contains only VERIFIED factors, so [0] can never
      // pick up an abandoned half-enrolment.
      const factor = factorData.totp[0];
      if (!factor) {
        toast.error("No supported second factor found for this account");
        return;
      }
      await challengeAndVerifyTotp(factor.id, mfaCode);
      toast.success("Successfully logged in");
      // The verify call refreshes the session to AAL2; useAuth hears the auth
      // state change, clears needsMfa, and the effect above redirects home.
    } catch (err: any) {
      toast.error(err.message || "Invalid code, try again");
      setMfaCode("");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen w-full bg-slate-50">
      {/* Left Pane - Branding & Visuals */}
      <div className="hidden lg:flex lg:w-1/2 relative bg-primary overflow-hidden flex-col justify-between p-12">
        {/* Decorative background elements */}
        <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none">
          <div className="absolute -top-24 -left-24 w-96 h-96 rounded-full bg-white/10 blur-3xl"></div>
          <div className="absolute bottom-0 right-0 w-[40rem] h-[40rem] rounded-full bg-emerald-900/20 blur-3xl translate-x-1/3 translate-y-1/3"></div>
        </div>

        <div className="relative z-10">
          <div className="flex items-center gap-3 text-white mb-16">
            <ShieldCheck className="w-8 h-8" />
            <span className="font-bold text-2xl tracking-tight">Inspectra</span>
          </div>
          <div className="max-w-md">
            <h1 className="text-4xl font-bold text-white mb-6 leading-tight">
              Sanitary Inspection &amp; Risk Classification System
            </h1>
            <p className="text-emerald-50/80 text-lg leading-relaxed">
              Empowering health inspectors with precision tools, real-time data synchronization, and automated risk assessments to ensure public safety and compliance.
            </p>
          </div>
        </div>

        <div className="relative z-10">
          <div className="flex items-center gap-4 text-emerald-100/60 text-sm font-medium">
            <span>© {new Date().getFullYear()} Inspectra Systems</span>
            <span>•</span>
            {legalLink("privacy", "Privacy", "hover:text-white transition-colors")}
            <span>•</span>
            {legalLink("terms", "Terms", "hover:text-white transition-colors")}
          </div>
        </div>
      </div>

      {/* Right Pane - Login Form */}
      <div className="flex-1 flex flex-col justify-center items-center p-8 lg:p-12 relative">
        {/* Mobile Logo */}
        <div className="lg:hidden absolute top-8 left-8 flex items-center gap-2 text-primary">
          <ShieldCheck className="w-6 h-6" />
          <span className="font-bold text-xl tracking-tight">Inspectra</span>
        </div>

        <div className="w-full max-w-sm space-y-8">
          {session && needsMfa ? (
            <>
              <div className="space-y-2 text-center lg:text-left">
                <div className="mx-auto lg:mx-0 w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-2">
                  <ShieldQuestion className="w-6 h-6 text-primary" />
                </div>
                <h2 className="text-3xl font-bold tracking-tight text-slate-900">Two-factor verification</h2>
                <p className="text-slate-500">Enter the 6-digit code from your authenticator app</p>
              </div>

              <form onSubmit={handleMfaSubmit} className="space-y-6">
                <div className="flex justify-center">
                  <InputOTP maxLength={6} value={mfaCode} onChange={setMfaCode} autoFocus>
                    <InputOTPGroup>
                      {Array.from({ length: 6 }).map((_, i) => (
                        <InputOTPSlot key={i} index={i} />
                      ))}
                    </InputOTPGroup>
                  </InputOTP>
                </div>
                <Button
                  type="submit"
                  className="w-full h-12 text-base font-medium bg-primary hover:bg-primary/90 text-primary-foreground shadow-sm transition-all"
                  disabled={isLoading || mfaCode.length !== 6}
                >
                  {isLoading ? (
                    <div className="w-5 h-5 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin mr-2" />
                  ) : null}
                  Verify
                </Button>
                <button
                  type="button"
                  onClick={async () => {
                    // The half-authenticated AAL1 session must not linger —
                    // abandoning the challenge means signing out of it.
                    await supabase.auth.signOut();
                    setMfaCode("");
                  }}
                  className="w-full text-center text-sm text-slate-500 hover:text-slate-700 hover:underline"
                >
                  Back to sign in
                </button>
              </form>
            </>
          ) : (
          <>
          <div className="space-y-2 text-center lg:text-left">
            <h2 className="text-3xl font-bold tracking-tight text-slate-900">Welcome back to Inspectra</h2>
            <p className="text-slate-500">Sign in to your account to continue</p>
          </div>

          <div className="space-y-6">
            <form onSubmit={handleEmailLogin} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email" className="sr-only">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="name@example.com"
                  className="h-12 bg-white border-slate-200 focus-visible:ring-primary/20"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <Label htmlFor="password">Password</Label>
                </div>
                <Input
                  id="password"
                  type="password"
                  className="h-12 bg-white border-slate-200 focus-visible:ring-primary/20"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
              <label className="flex items-start gap-2 text-sm text-slate-600 cursor-pointer">
                <input
                  type="checkbox"
                  className="mt-1 accent-emerald-600"
                  checked={agreed}
                  onChange={(e) => setAgreed(e.target.checked)}
                />
                <span>
                  I have read and agree to the{" "}
                  {legalLink("terms", "Terms and Conditions", "text-primary font-medium hover:underline")}
                  {" "}and{" "}
                  {legalLink("privacy", "Privacy Policy", "text-primary font-medium hover:underline")}.
                </span>
              </label>
              <Button 
                type="submit" 
                className="w-full h-12 text-base font-medium bg-primary hover:bg-primary/90 text-primary-foreground shadow-sm transition-all"
                disabled={isLoading || !agreed}
              >
                {isLoading ? (
                  <div className="w-5 h-5 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin mr-2" />
                ) : null}
                Sign In
              </Button>
            </form>

            <p className="text-center text-sm text-slate-500">
              Accounts are issued by the City Health Office administrator.
            </p>
          </div>
          </>
          )}
        </div>
      </div>

      <Dialog open={legal !== null} onOpenChange={(open) => { if (!open) setLegal(null); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-slate-900 font-bold">{legal ? LEGAL[legal].title : ""}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm text-slate-600 leading-relaxed max-h-[60vh] overflow-y-auto">
            {legal ? LEGAL[legal].body.map((p) => <p key={p}>{p}</p>) : null}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
