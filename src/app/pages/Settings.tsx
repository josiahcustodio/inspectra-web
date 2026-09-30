import { useState } from "react";
import {
  multiFactor,
  TotpMultiFactorGenerator,
  EmailAuthProvider,
  GoogleAuthProvider,
  reauthenticateWithCredential,
  reauthenticateWithPopup,
  type TotpSecret,
} from "firebase/auth";
import QRCode from "qrcode";
import { toast } from "sonner";
import { Card } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "../components/ui/dialog";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "../components/ui/input-otp";
import { User, KeyRound, Trash2 } from "lucide-react";
import { useAuth } from "../../lib/useAuth";

// [REF: MFA_TOTP_ENROLL]
function SecuritySettings() {
  const { user } = useAuth();
  const enrolledTotp = user
    ? multiFactor(user).enrolledFactors.find((f) => f.factorId === TotpMultiFactorGenerator.FACTOR_ID)
    : undefined;

  const [dialogOpen, setDialogOpen] = useState(false);
  const [step, setStep] = useState<"reauth" | "qr" | "code">("qr");
  const [reauthPassword, setReauthPassword] = useState("");
  const [totpSecret, setTotpSecret] = useState<TotpSecret | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [code, setCode] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [, forceRerender] = useState(0);

  const usesPassword = user?.providerData.some((p) => p.providerId === "password") ?? false;

  const beginEnrollment = async () => {
    if (!user) return;
    setDialogOpen(true);
    setStep("qr");
    setIsLoading(true);
    try {
      const session = await multiFactor(user).getSession();
      const secret = await TotpMultiFactorGenerator.generateSecret(session);
      const otpauthUrl = secret.generateQrCodeUrl(user.email ?? user.uid, "Inspectra");
      const dataUrl = await QRCode.toDataURL(otpauthUrl, { width: 220, margin: 1 });
      setTotpSecret(secret);
      setQrDataUrl(dataUrl);
    } catch (err: any) {
      if (err.code === "auth/requires-recent-login") {
        setStep("reauth");
      } else {
        toast.error(err.message || "Failed to start 2FA setup");
        setDialogOpen(false);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleReauth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setIsLoading(true);
    try {
      if (usesPassword) {
        if (!user.email) throw new Error("No email on account");
        const credential = EmailAuthProvider.credential(user.email, reauthPassword);
        await reauthenticateWithCredential(user, credential);
      } else {
        await reauthenticateWithPopup(user, new GoogleAuthProvider());
      }
      setReauthPassword("");
      await beginEnrollment();
    } catch (err: any) {
      toast.error(err.message || "Re-authentication failed");
    } finally {
      setIsLoading(false);
    }
  };

  const handleConfirmCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !totpSecret || code.length !== 6) return;
    setIsLoading(true);
    try {
      const assertion = TotpMultiFactorGenerator.assertionForEnrollment(totpSecret, code);
      await multiFactor(user).enroll(assertion, "Authenticator app");
      toast.success("Two-factor authentication enabled");
      setDialogOpen(false);
      setCode("");
      setTotpSecret(null);
      forceRerender((n) => n + 1);
    } catch (err: any) {
      toast.error(err.message || "Invalid code, try again");
    } finally {
      setIsLoading(false);
    }
  };

  const handleUnenroll = async () => {
    if (!user || !enrolledTotp) return;
    try {
      await multiFactor(user).unenroll(enrolledTotp.uid);
      toast.success("Two-factor authentication disabled");
      forceRerender((n) => n + 1);
    } catch (err: any) {
      toast.error(err.message || "Failed to disable 2FA");
    }
  };

  return (
    <Card className="p-6 bg-white rounded-xl lg:col-span-2 shadow-sm">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-full bg-slate-50 flex items-center justify-center border border-slate-100">
          <KeyRound className="w-5 h-5 text-primary" />
        </div>
        <h3 className="font-bold text-slate-900 text-lg">Two-Factor Authentication</h3>
      </div>

      {enrolledTotp ? (
        <div className="flex items-center justify-between rounded-lg border border-slate-200 px-4 py-3">
          <div>
            <p className="font-bold text-slate-900">Authenticator app enabled</p>
            <p className="text-sm text-slate-500">{enrolledTotp.displayName ?? "TOTP factor"}</p>
          </div>
          <Button variant="outline" className="text-destructive border-destructive/30 hover:bg-destructive/10" onClick={handleUnenroll}>
            <Trash2 className="w-4 h-4" />
            Remove
          </Button>
        </div>
      ) : (
        <div className="flex items-center justify-between rounded-lg border border-slate-200 px-4 py-3">
          <div>
            <p className="font-bold text-slate-900">Authenticator app</p>
            <p className="text-sm text-slate-500">Require a 6-digit code from an app like Google Authenticator at sign-in</p>
          </div>
          <Button onClick={beginEnrollment} className="bg-primary hover:bg-primary/90 text-primary-foreground">
            Enable
          </Button>
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          {step === "reauth" && (
            <form onSubmit={handleReauth}>
              <DialogHeader>
                <DialogTitle>Confirm it's you</DialogTitle>
                <DialogDescription>
                  This is a sensitive action — please re-authenticate to continue.
                </DialogDescription>
              </DialogHeader>
              {usesPassword ? (
                <div className="space-y-2 py-4">
                  <Label htmlFor="reauth-password">Password</Label>
                  <Input
                    id="reauth-password"
                    type="password"
                    value={reauthPassword}
                    onChange={(e) => setReauthPassword(e.target.value)}
                    required
                    autoFocus
                  />
                </div>
              ) : (
                <p className="py-4 text-sm text-slate-500">Click continue to confirm with Google.</p>
              )}
              <DialogFooter>
                <Button type="submit" disabled={isLoading} className="bg-primary hover:bg-primary/90 text-primary-foreground">
                  Continue
                </Button>
              </DialogFooter>
            </form>
          )}

          {step === "qr" && (
            <>
              <DialogHeader>
                <DialogTitle>Scan with your authenticator app</DialogTitle>
                <DialogDescription>
                  Use Google Authenticator, Authy, or a similar app to scan this code, then enter the 6-digit code it shows.
                </DialogDescription>
              </DialogHeader>
              <div className="flex flex-col items-center gap-3 py-2">
                {isLoading || !qrDataUrl ? (
                  <div className="w-8 h-8 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
                ) : (
                  <>
                    <img src={qrDataUrl} alt="TOTP QR code" className="rounded-lg border border-slate-200" />
                    <p className="text-xs text-slate-500 text-center">
                      Can't scan? Enter this key manually:
                      <br />
                      <span className="font-mono font-bold text-slate-900 break-all">{totpSecret?.secretKey}</span>
                    </p>
                  </>
                )}
              </div>
              <DialogFooter>
                <Button
                  disabled={!qrDataUrl}
                  onClick={() => setStep("code")}
                  className="bg-primary hover:bg-primary/90 text-primary-foreground w-full"
                >
                  I've scanned it — Enter code
                </Button>
              </DialogFooter>
            </>
          )}

          {step === "code" && (
            <form onSubmit={handleConfirmCode}>
              <DialogHeader>
                <DialogTitle>Enter the 6-digit code</DialogTitle>
                <DialogDescription>From your authenticator app, to confirm setup.</DialogDescription>
              </DialogHeader>
              <div className="flex justify-center py-4">
                <InputOTP maxLength={6} value={code} onChange={setCode} autoFocus>
                  <InputOTPGroup>
                    {Array.from({ length: 6 }).map((_, i) => (
                      <InputOTPSlot key={i} index={i} />
                    ))}
                  </InputOTPGroup>
                </InputOTP>
              </div>
              <DialogFooter>
                <Button
                  type="submit"
                  disabled={code.length !== 6 || isLoading}
                  className="bg-primary hover:bg-primary/90 text-primary-foreground w-full"
                >
                  {isLoading ? "Verifying..." : "Confirm"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

export function Settings() {
  const { user, role } = useAuth();
  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-bold text-slate-900 text-2xl tracking-tight">Settings</h2>
        <p className="text-muted-foreground mt-1">Manage your account and security</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Account — read straight from Firebase Auth + the Firestore profile */}
        <Card className="p-6 bg-white rounded-xl  lg:col-span-2 shadow-sm">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-full bg-slate-50 flex items-center justify-center border border-slate-100">
              <User className="w-5 h-5 text-primary" />
            </div>
            <h3 className="font-bold text-slate-900 text-lg">Account</h3>
          </div>
          <div className="space-y-4">
            <div>
              <Label htmlFor="email" className="text-slate-700 font-bold text-xs uppercase tracking-wider">Email Address</Label>
              <Input
                id="email"
                type="email"
                value={user?.email ?? ""}
                disabled
                className="mt-1.5"
              />
              <p className="text-xs text-slate-500 mt-1">Signed in as this account — contact an admin to change it.</p>
            </div>
            <div>
              <Label className="text-slate-700 font-bold text-xs uppercase tracking-wider">Role</Label>
              <p className="mt-1.5 font-bold text-slate-900 capitalize">{role ?? "—"}</p>
              <p className="text-xs text-slate-500 mt-1">Roles are assigned by administrators.</p>
            </div>
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <SecuritySettings />
      </div>
    </div>
  );
}
