import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Button } from "../components/ui/button";
import { ShieldCheck, MailCheck } from "lucide-react";
import { sendEmailVerification, signOut } from "firebase/auth";
import { auth } from "../../lib/firebase";
import { toast } from "sonner";
import { useAuth } from "../../lib/useAuth";

const RESEND_COOLDOWN_SECONDS = 30;

export function VerifyEmail() {
  const navigate = useNavigate();
  const { user, session, emailVerified, isLoading, refreshUser } = useAuth();
  const [isChecking, setIsChecking] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (!isLoading && !session) navigate("/login", { replace: true });
  }, [isLoading, session, navigate]);

  useEffect(() => {
    if (emailVerified) navigate("/", { replace: true });
  }, [emailVerified, navigate]);

  if ((!isLoading && !session) || emailVerified) return null;

  const handleResend = async () => {
    if (!auth.currentUser || cooldown > 0) return;
    try {
      await sendEmailVerification(auth.currentUser);
      toast.success("Verification email sent");
      setCooldown(RESEND_COOLDOWN_SECONDS);
      const timer = setInterval(() => {
        setCooldown((prev) => {
          if (prev <= 1) {
            clearInterval(timer);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } catch (err: any) {
      toast.error(err.message || "Failed to resend email");
    }
  };

  const handleCheckVerified = async () => {
    setIsChecking(true);
    try {
      await refreshUser();
      if (auth.currentUser?.emailVerified) {
        toast.success("Email verified");
        navigate("/", { replace: true });
      } else {
        toast.info("Still not verified. Check your inbox and click the link.");
      }
    } finally {
      setIsChecking(false);
    }
  };

  const handleSignOut = async () => {
    await signOut(auth);
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
            <span className="font-medium text-slate-900">{user?.email}</span>. Click it, then come
            back here.
          </p>
        </div>

        <div className="space-y-3 pt-2">
          <Button
            className="w-full h-12 bg-primary hover:bg-primary/90 text-primary-foreground"
            onClick={handleCheckVerified}
            disabled={isChecking}
          >
            {isChecking ? "Checking..." : "I've verified — Continue"}
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
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
