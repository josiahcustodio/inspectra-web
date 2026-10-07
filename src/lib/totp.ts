import { supabase } from "./supabase";

// [REF: TOTP_CHALLENGE_VERIFY]
//
// The one challenge→verify round-trip both TOTP flows share: sign-in
// (Login's OTP pane, against an already-verified factor) and enrolment
// confirmation (Settings, against the factor just minted). Supabase treats
// them identically — and in BOTH cases a successful verify also upgrades the
// current session to AAL2, which is what the restrictive RLS policies wait
// for. Throws with the server's message on a wrong/expired code; callers own
// their own toast/retry UX.
export async function challengeAndVerifyTotp(factorId: string, code: string): Promise<void> {
  const { data: challenge, error: challengeError } =
    await supabase.auth.mfa.challenge({ factorId });
  if (challengeError) throw challengeError;
  const { error: verifyError } = await supabase.auth.mfa.verify({
    factorId,
    challengeId: challenge.id,
    code,
  });
  if (verifyError) throw verifyError;
}
