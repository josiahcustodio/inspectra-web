import { useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { ShieldCheck } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { challengeAndVerifyTotp } from "@/lib/totp";
import { toast } from "sonner";

// [REF: WEB_RESET_PASSWORD]
// Target of the recovery email, for accounts from both clients: the mobile app
// has no deep link, so its reset also lands here. The template links here with
// token_hash (see supabase/templates/reset-password.html) rather than
// {{ .ConfirmationURL }} so the one-time token is spent on submit, not when a
// mail scanner fetches the link, and so it works without the PKCE verifier
// held by the app that requested the email.
export function ResetPassword() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const tokenHash = params.get("token_hash");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [needsCode, setNeedsCode] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  // The token is single use: a retry after a rejected password must not spend it twice.
  const verified = useRef(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) {
      toast.error("Password must be at least 8 characters");
      return;
    }
    if (password !== confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }

    setIsLoading(true);
    try {
      if (!verified.current) {
        const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash!, type: "recovery" });
        if (error) throw error;
        verified.current = true;
      }

      // Supabase refuses a password change at AAL1 once TOTP is enrolled, so
      // the recovery session has to present the second factor first.
      if (needsCode) {
        const { data, error } = await supabase.auth.mfa.listFactors();
        if (error) throw error;
        await challengeAndVerifyTotp(data.totp[0].id, mfaCode);
      } else {
        const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
        if (data?.currentLevel === "aal1" && data?.nextLevel === "aal2") {
          setNeedsCode(true);
          return;
        }
      }

      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      await supabase.auth.signOut();
      toast.success("Password updated. Sign in with your new password.");
      navigate("/login", { replace: true });
    } catch (err: any) {
      toast.error(err.message || "Could not reset your password");
      setMfaCode("");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full bg-slate-50 flex flex-col items-center justify-center p-8">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex items-center justify-center gap-2 text-primary">
          <ShieldCheck className="w-6 h-6" />
          <span className="font-bold text-xl tracking-tight">Inspectra</span>
        </div>

        {!tokenHash ? (
          <div className="space-y-4 text-center">
            <h2 className="text-2xl font-bold tracking-tight text-slate-900">Invalid reset link</h2>
            <p className="text-slate-500">Open the link from your reset email, or request a new one.</p>
            <Link to="/login" className="text-primary font-medium hover:underline">
              Back to sign in
            </Link>
          </div>
        ) : (
          <>
            <h2 className="text-2xl font-bold tracking-tight text-slate-900 text-center">
              {needsCode ? "Two-factor verification" : "Set a new password"}
            </h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              {needsCode ? (
                <div className="space-y-4">
                  <p className="text-slate-500 text-center">Enter the 6-digit code from your authenticator app</p>
                  <div className="flex justify-center">
                    <InputOTP maxLength={6} value={mfaCode} onChange={setMfaCode} autoFocus>
                      <InputOTPGroup>
                        {Array.from({ length: 6 }).map((_, i) => (
                          <InputOTPSlot key={i} index={i} />
                        ))}
                      </InputOTPGroup>
                    </InputOTP>
                  </div>
                </div>
              ) : (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="password">New password</Label>
                    <Input
                      id="password"
                      type="password"
                      autoComplete="new-password"
                      className="h-12 bg-white border-slate-200 focus-visible:ring-primary/20"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      minLength={8}
                    />
                    <p className="text-xs text-slate-500">At least 8 characters</p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="confirmPassword">Confirm password</Label>
                    <Input
                      id="confirmPassword"
                      type="password"
                      autoComplete="new-password"
                      className="h-12 bg-white border-slate-200 focus-visible:ring-primary/20"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      required
                    />
                  </div>
                </>
              )}
              <Button
                type="submit"
                className="w-full h-12 text-base font-medium bg-primary hover:bg-primary/90 text-primary-foreground shadow-sm transition-all"
                disabled={isLoading || (needsCode && mfaCode.length !== 6)}
              >
                {isLoading ? "Saving..." : needsCode ? "Verify and update password" : "Update password"}
              </Button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
