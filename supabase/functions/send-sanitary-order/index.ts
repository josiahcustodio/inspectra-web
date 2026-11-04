// [REF: SO_EMAIL_DELIVERY]
//
// POST /functions/v1/send-sanitary-order
// Body: { "logId": "<uuid>", "resend": false }
// Returns: { sent: true, to, emailSentAt }
//
// Emails a reference copy of one Sanitary Order to the establishment's point
// person. This is a CONVENIENCE, not the service of notice: the order is served
// on site and acknowledged by the recipient's signature on the phone, which is
// what `received_signature_url` records. The only delivery claim this function
// makes is `email_sent_at` — that a copy was sent, never that anyone read it.
//
// Why this exists instead of an owner login: the recipient needs no account to
// receive a copy, which is also what makes it work for iOS owners without
// hosting the admin app for them. See the project plan for the deferred
// Supabase email-OTP path if in-app viewing is ever required.
//
// Security stance (mirrors generate-barangay-summary):
//  - Reads and the email_sent_at write run under the CALLER's JWT, no
//    service-role key, so RLS still scopes everything this function can see.
//  - Authorization is nonetheless CHECKED HERE, explicitly. It used to be
//    inferred: "inspection_logs_update is gated on is_authorized(), so only an
//    officer or admin can get this far." That reasoning died the moment
//    06_owner_role.sql gave `owner` SELECT on inspection_logs and
//    establishments — an owner could then pass every read in `handle`, the
//    email would be sent, and the stamp would be the only thing RLS refused.
//    A PostgREST update matching no row returns no error, so the function
//    answered 200 {sent:true} with email_sent_at still null: the 409 dedup
//    never armed, and the same owner could mail themselves unlimited copies
//    through the office provider while the record read "no copy emailed".
//  - BREVO_API_KEY lives only in Supabase secrets; the browser never sees it.
//  - Edge Functions are served from the Supabase origin the web app's CSP
//    already allows, so no CSP change is needed.
//  - Defect text is inspector free text and is escaped by render.ts before it
//    enters the markup.
//
// Deploy:   supabase functions deploy send-sanitary-order
// Secrets:  supabase secrets set BREVO_API_KEY=xkeysib-...
//           supabase secrets set SANITARY_ORDER_FROM="City Health Office <no-reply@yourdomain>"
// Test:     deno test supabase/functions/send-sanitary-order/

import { createClient } from "npm:@supabase/supabase-js@2";
import {
  EstablishmentRow,
  OrderRow,
  parseSender,
  renderHtml,
  renderSubject,
} from "./render.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });

const ORDER_COLUMNS =
  "id, so_no, so_issued_at, email_sent_at, inspection_date, inspector_name, " +
  "time_given, deadline, received_by_name, establishment_id, establishment_name, results";

const ESTABLISHMENT_COLUMNS =
  "business_name, owner_name, barangay, address, control_no, " +
  "point_person_name, point_person_email";

// The one provider-specific function in this file. Swapping Brevo for SMTP or
// another API is a change here and nowhere else.
//
// SANITARY_ORDER_FROM keeps the "Name <addr>" shape even though Brevo wants
// the two halves apart: it is the shape an operator already knows from every
// other mail config, and parseSender costs one regex.
async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  const key = Deno.env.get("BREVO_API_KEY");
  if (!key) {
    throw new Error(
      "BREVO_API_KEY is not set. Run: supabase secrets set BREVO_API_KEY=xkeysib-...",
    );
  }
  const from = Deno.env.get("SANITARY_ORDER_FROM");
  if (!from) {
    throw new Error(
      "SANITARY_ORDER_FROM is not set (e.g. \"City Health Office <no-reply@example.gov.ph>\"). " +
        "It must be an address on a domain verified with the mail provider.",
    );
  }

  const { name: senderName, email: senderEmail } = parseSender(from);
  if (!senderEmail.includes("@")) {
    throw new Error(
      `SANITARY_ORDER_FROM ("${from}") does not contain an email address.`,
    );
  }

  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": key,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      sender: senderName ? { name: senderName, email: senderEmail } : { email: senderEmail },
      to: [{ email: to }],
      subject,
      htmlContent: html,
    }),
  });

  if (!res.ok) {
    // The provider's message is the only thing that distinguishes an
    // unverified sender domain from a rejected recipient, and the operator
    // needs to see which.
    const detail = await res.text().catch(() => "");
    throw new Error(`mail provider refused the send (${res.status}): ${detail.slice(0, 500)}`);
  }
}

Deno.serve(async (req) => {
  // Without this the Edge Runtime turns any throw into a bodyless
  // "500 Internal Server Error", which tells the operator nothing — a missing
  // BREVO_API_KEY and an unverified sender domain look identical.
  try {
    return await handle(req);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("send-sanitary-order failed:", message);
    return json(500, { error: message });
  }
});

async function handle(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json(405, { error: "Use POST." });

  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } },
  );
  const { data: auth } = await db.auth.getUser();
  if (!auth?.user) return json(401, { error: "Sign in to send a Sanitary Order." });

  // Staff only, asserted rather than inferred — see the security note above.
  // profiles_select permits exactly this one row, and the restrictive MFA
  // policy applies to it, so a TOTP-enrolled account sitting at AAL1 cannot
  // read its own role and therefore cannot send.
  const { data: me } = await db
    .from("profiles")
    .select("role")
    .eq("id", auth.user.id)
    .maybeSingle();
  if (me?.role !== "admin" && me?.role !== "officer") {
    return json(403, {
      error: "Only City Health Office staff can send a Sanitary Order copy.",
    });
  }

  let body: { logId?: string; resend?: boolean } = {};
  try {
    if (req.headers.get("content-type")?.includes("application/json")) {
      body = await req.json();
    }
  } catch {
    // Falls through to the missing-logId error below, which names the problem.
  }
  if (!body.logId) return json(400, { error: "logId is required." });

  const { data: order, error: orderError } = await db
    .from("inspection_logs")
    .select(ORDER_COLUMNS)
    .eq("id", body.logId)
    .maybeSingle();
  if (orderError) return json(500, { error: `inspection_logs: ${orderError.message}` });
  // Also the RLS outcome: a caller who may not read the row sees nothing, and
  // "not found" is the honest answer to give them.
  if (!order) return json(404, { error: "Inspection not found." });

  // so_issued_at, not so_no: the number is typed off CHO's pre-numbered
  // booklet and may legitimately be blank on a real order.
  if (!order.so_issued_at) {
    return json(422, {
      error: "This inspection did not issue a Sanitary Order, so there is nothing to send.",
    });
  }

  // A legal notice is not something to mail twice by accident — a second copy
  // with a different timestamp invites an argument about which one counts.
  // Resending stays possible, but only when asked for explicitly.
  if (order.email_sent_at && !body.resend) {
    return json(409, {
      error: `A copy was already emailed on ${order.email_sent_at}. ` +
        "Pass resend: true to send it again.",
      emailSentAt: order.email_sent_at,
    });
  }

  if (!order.establishment_id) {
    // Reachable: inspection_logs has no FK on establishment_id because
    // dangling references exist in live data and history must outlive deletes.
    return json(422, {
      error: "This inspection is not linked to an establishment, so there is no address to send to.",
    });
  }

  const { data: est, error: estError } = await db
    .from("establishments")
    .select(ESTABLISHMENT_COLUMNS)
    .eq("id", order.establishment_id)
    .maybeSingle();
  if (estError) return json(500, { error: `establishments: ${estError.message}` });
  if (!est) return json(404, { error: "Establishment not found." });

  const to = (est.point_person_email ?? "").trim();
  if (!to) {
    return json(422, {
      error: "This establishment has no point person email. Add one on the " +
        "establishment record, then send the copy.",
    });
  }

  const orderRow = order as unknown as OrderRow;
  const estRow = est as unknown as EstablishmentRow;

  await sendEmail(to, renderSubject(orderRow, estRow), renderHtml(orderRow, estRow));

  // Stamped only after the provider accepted it, and a failure to stamp is
  // reported rather than swallowed: email_sent_at is the office's record that
  // a copy went out, and a sent-but-unstamped order would be mailed again on
  // the next attempt.
  const sentAt = new Date().toISOString();
  // `.select("id")` is not decoration: a PostgREST update that matches no row
  // — which is what an RLS refusal looks like — returns `{ error: null }`.
  // Without asking for the affected rows back, a silently rejected stamp was
  // indistinguishable from a successful one, and the caller was told the send
  // was recorded when it was not.
  const { data: stamped, error: stampError } = await db
    .from("inspection_logs")
    .update({ email_sent_at: sentAt })
    .eq("id", orderRow.id)
    .select("id");
  if (stampError || !stamped || stamped.length === 0) {
    return json(500, {
      error: `The copy was emailed to ${to}, but recording that failed` +
        `${stampError ? `: ${stampError.message}` : " (the update was refused)"}` +
        `. Do not resend without checking the record.`,
    });
  }

  return json(200, { sent: true, to, emailSentAt: sentAt });
}
