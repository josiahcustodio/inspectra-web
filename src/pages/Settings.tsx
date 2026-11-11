import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { challengeAndVerifyTotp } from "@/lib/totp";
import type { Factor } from "@supabase/supabase-js";
import QRCode from "qrcode";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import { User, KeyRound, Trash2, FileSpreadsheet } from "lucide-react";
import { useAuth } from "@/lib/useAuth";
import { exportIncludesCategory, setExportIncludesCategory } from "@/lib/exportPrefs";

// [REF: MFA_TOTP_ENROLL]
//
// TOTP enrolment is a two-step dialog: scan the QR, confirm a code. The
// Firebase-era "reauth" detour is gone — Supabase lets a signed-in session
// start an enrolment without a recent-login proof; the confirmation code is
// itself the proof, and verifying it also upgrades this session to AAL2.
function SecuritySettings() {
  const { user, role, mfaEnrolled, retryProfile } = useAuth();
  const mfaRequired = role === 'admin' || role === 'department_head';

  // The enrolled-factor state lives server-side; listFactors() is the truth.
  // Reloaded after every enrol/unenroll via the counter.
  const [enrolledTotp, setEnrolledTotp] = useState<Factor | undefined>(undefined);
  const [reloadCounter, setReloadCounter] = useState(0);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [step, setStep] = useState<"qr" | "code">("qr");
  const [factorId, setFactorId] = useState<string | null>(null);
  const [totpSecret, setTotpSecret] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [code, setCode] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    supabase.auth.mfa.listFactors().then(({ data }) => {
      if (!cancelled) setEnrolledTotp(data?.totp[0]);
    });
    return () => {
      cancelled = true;
    };
  }, [user, reloadCounter]);

  const beginEnrollment = async () => {
    if (!user) return;
    setDialogOpen(true);
    setStep("qr");
    setIsLoading(true);
    try {
      // An abandoned earlier attempt leaves an unverified factor behind, and
      // a second enroll would then be refused — clear any such leftover first.
      const { data: existing } = await supabase.auth.mfa.listFactors();
      for (const f of existing?.all ?? []) {
        if (f.factor_type === "totp" && f.status === "unverified") {
          await supabase.auth.mfa.unenroll({ factorId: f.id });
        }
      }

      const { data, error } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: "Authenticator app",
        issuer: "Inspectra",
      });
      if (error) throw error;
      const dataUrl = await QRCode.toDataURL(data.totp.uri, { width: 220, margin: 1 });
      setFactorId(data.id);
      setTotpSecret(data.totp.secret);
      setQrDataUrl(dataUrl);
    } catch (err: any) {
      toast.error(err.message || "Failed to start 2FA setup");
      setDialogOpen(false);
    } finally {
      setIsLoading(false);
    }
  };

  const handleConfirmCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !factorId || code.length !== 6) return;
    setIsLoading(true);
    try {
      await challengeAndVerifyTotp(factorId, code);
      toast.success("Two-factor authentication enabled");
      setDialogOpen(false);
      setCode("");
      setFactorId(null);
      setTotpSecret(null);
      setReloadCounter((n) => n + 1);
      // Lets AuthGuard release an admin who was held here to enrol.
      void retryProfile();
    } catch (err: any) {
      toast.error(err.message || "Invalid code, try again");
    } finally {
      setIsLoading(false);
    }
  };

  const handleUnenroll = async () => {
    if (!user || !enrolledTotp) return;
    try {
      const { error } = await supabase.auth.mfa.unenroll({ factorId: enrolledTotp.id });
      if (error) throw error;
      toast.success("Two-factor authentication disabled");
      setReloadCounter((n) => n + 1);
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

      {mfaRequired && !mfaEnrolled && (
        <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Two-factor authentication is required for your account. Set it up
          below to continue using the portal.
        </p>
      )}

      {enrolledTotp ? (
        <div className="flex items-center justify-between rounded-lg border border-slate-200 px-4 py-3">
          <div>
            <p className="font-bold text-slate-900">Authenticator app enabled</p>
            <p className="text-sm text-slate-500">{enrolledTotp.friendly_name ?? "TOTP factor"}</p>
          </div>
          {mfaRequired ? (
            <p className="text-sm text-slate-500">Required for your account</p>
          ) : (
            <Button variant="outline" className="text-destructive border-destructive/30 hover:bg-destructive/10" onClick={handleUnenroll}>
              <Trash2 className="w-4 h-4" />
              Remove
            </Button>
          )}
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
                      <span className="font-mono font-bold text-slate-900 break-all">{totpSecret}</span>
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

// [REF: MASTERLIST_EXPORT_PREFS]
// Admin-only card: whether the Masterlist page's Excel export includes the
// Category column. Category is web-view data (assigned by inspections, not
// by the uploaded masterlist), so the official export format leaves it out
// unless an admin opts in — and it stays empty for anything not yet
// inspected. Stored in this browser's localStorage, not in the database: it is
// a personal export preference, not shared data.
function ExportSettings() {
  const [includeCategory, setIncludeCategory] = useState(exportIncludesCategory());

  const toggle = (on: boolean) => {
    setExportIncludesCategory(on);
    setIncludeCategory(on);
  };

  return (
    <Card className="p-6 bg-white rounded-xl lg:col-span-2 shadow-sm">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-full bg-slate-50 flex items-center justify-center border border-slate-100">
          <FileSpreadsheet className="w-5 h-5 text-primary" />
        </div>
        <h3 className="font-bold text-slate-900 text-lg">Masterlist Export</h3>
      </div>
      <label className="flex items-start gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={includeCategory}
          onChange={(e) => toggle(e.target.checked)}
          className="mt-1"
        />
        <span>
          <span className="font-bold text-slate-900 text-sm">Include the Category column in Excel exports</span>
          <p className="text-xs text-slate-500 mt-1">
            Category is assigned when an establishment gets inspected (from the checklist used),
            so it's not part of the official masterlist format and is empty for anything not yet
            inspected. Off by default; applies to exports from this browser.
          </p>
        </span>
      </label>
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
        {/* Account — read straight from Supabase Auth + the profiles row */}
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

      {role === "admin" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <ExportSettings />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <SecuritySettings />
      </div>
    </div>
  );
}
