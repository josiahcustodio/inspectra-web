// [REF: PROVISION_OWNER]
//
// POST /functions/v1/provision-owner
// Body: { "logId": "<uuid>" }
// Returns: { email, userId, establishmentId, created }
//
// Approves the point person an inspector recorded in the field, and grants
// them read access to that establishment's inspection records.
//
// What it does, in order, and all of it idempotent:
//   1. verifies the CALLER is an admin, under the caller's own JWT
//   2. reads the proposal off the inspection log
//   3. finds or creates the auth user for that address
//   4. promotes 'pending' -> 'owner' (never touches a staff role)
//   5. inserts the establishment_contacts grant
//   6. copies the address onto establishments.point_person_email, which is
//      what send-sanitary-order actually reads
//
// SECURITY — this function is different from send-sanitary-order and must be
// read as such. That one runs entirely under the caller's JWT, so RLS is the
// authorization. This one needs the service-role key (creating an auth user
// and writing another user's profile row are both beyond any client), which
// means RLS is NOT protecting anything here. The admin check in step 1 is the
// only thing standing between a signed-in officer and the ability to grant
// themselves access to any establishment, so it runs first, under the caller's
// own token, and nothing else happens until it passes.
//
// Deploy:   supabase functions deploy provision-owner
// Secrets:  SUPABASE_SERVICE_ROLE_KEY is injected by the platform; no secret
//           needs setting by hand.

import { createClient } from "npm:@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });

// Same shape the Flutter client and the login screen enforce. One address
// shape for the whole system.
const EMAIL_SHAPE = /^[\w.-]+@[\w.-]+\.[a-zA-Z]{2,}$/;

Deno.serve(async (req) => {
  try {
    return await handle(req);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("provision-owner failed:", message);
    return json(500, { error: message });
  }
});

async function handle(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json(405, { error: "Use POST." });

  const url = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!serviceKey) {
    return json(500, {
      error: "SUPABASE_SERVICE_ROLE_KEY is not available to this function.",
    });
  }

  // ── 1. Who is asking ──────────────────────────────────────────────────────
  // Under the CALLER's token, so RLS and the restrictive MFA policy both
  // apply: an admin sitting at AAL1 with a TOTP factor enrolled cannot read
  // even their own profile row, and therefore cannot reach step 2.
  const caller = createClient(url, anonKey, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });

  const { data: auth } = await caller.auth.getUser();
  if (!auth?.user) return json(401, { error: "Sign in to grant access." });

  const { data: me } = await caller
    .from("profiles")
    .select("role")
    .eq("id", auth.user.id)
    .maybeSingle();

  if (me?.role !== "admin") {
    // Deliberately the same answer for an officer, a pending account and a
    // profile this session could not read. Granting standing access to
    // inspection records is an admin act; nothing below runs otherwise.
    return json(403, {
      error: "Only an administrator can grant point person access.",
    });
  }

  let body: { logId?: string } = {};
  try {
    if (req.headers.get("content-type")?.includes("application/json")) {
      body = await req.json();
    }
  } catch {
    // Falls through to the missing-logId error, which names the problem.
  }
  if (!body.logId) return json(400, { error: "logId is required." });

  // ── 2. The proposal ───────────────────────────────────────────────────────
  // Still the caller's client: an admin can read inspection_logs, and reading
  // it under RLS keeps one fewer operation on the privileged client.
  const { data: log, error: logError } = await caller
    .from("inspection_logs")
    .select(
      "id, establishment_id, establishment_name, " +
        "proposed_point_person_name, proposed_point_person_email",
    )
    .eq("id", body.logId)
    .maybeSingle();
  if (logError) return json(500, { error: `inspection_logs: ${logError.message}` });
  if (!log) return json(404, { error: "Inspection not found." });

  const email = (log.proposed_point_person_email ?? "").trim().toLowerCase();
  if (!email) {
    return json(422, {
      error: "This inspection did not record a point person email.",
    });
  }
  if (!EMAIL_SHAPE.test(email)) {
    return json(422, {
      error: `"${email}" is not a usable email address. Correct it on the ` +
        "establishment record instead of approving this one.",
    });
  }
  if (!log.establishment_id) {
    // inspection_logs has no FK on establishment_id — dangling references
    // exist in live data because history outlives deletes.
    return json(422, {
      error: "This inspection is not linked to an establishment, so there is " +
        "nothing to grant access to.",
    });
  }

  // ── 3+. The privileged half ───────────────────────────────────────────────
  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // profiles carries the email, and profiles.id IS the auth uid — so this is
  // the lookup-by-address the Admin API does not offer (listUsers paginates
  // the whole project; getUserById needs the id we are trying to find).
  const { data: existing, error: existingError } = await admin
    .from("profiles")
    .select("id, role")
    .eq("email", email)
    .maybeSingle();
  if (existingError) {
    return json(500, { error: `profiles lookup: ${existingError.message}` });
  }

  // [REF: NEVER_DEMOTE_STAFF]
  // The guard that matters most here. An inspector typing a colleague's
  // address — or their own — must not cost that person their officer role and
  // with it their access to every establishment they work on. Refused rather
  // than skipped, because silently granting nothing while reporting success
  // would leave an admin believing the point person can sign in.
  if (existing && (existing.role === "admin" || existing.role === "officer")) {
    return json(409, {
      error: `${email} already belongs to a City Health Office staff account. ` +
        "Use a different address for the point person.",
    });
  }

  let userId = existing?.id as string | undefined;
  let created = false;

  if (!userId) {
    // email_confirm: true because the address is not being self-asserted —
    // an inspector recorded it on site and an admin is approving it here. The
    // mailbox still has to be controlled to actually sign in: the only way in
    // is the six-digit code mailed to it.
    const { data: newUser, error: createError } = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
    });
    if (createError || !newUser?.user) {
      return json(500, {
        error: `Could not create the account: ${createError?.message ?? "unknown error"}`,
      });
    }
    userId = newUser.user.id;
    created = true;
  }

  // 'owner', from 'pending' or from 'owner' — the staff cases were refused
  // above. The handle_new_user() trigger has already written the row as
  // 'pending' by the time this runs.
  const { error: roleError } = await admin
    .from("profiles")
    .update({ role: "owner", email })
    .eq("id", userId);
  if (roleError) {
    return json(500, { error: `Could not set the role: ${roleError.message}` });
  }

  // The grant itself. upsert, not insert: approving the same proposal twice
  // must be a no-op rather than a primary-key error.
  const { error: grantError } = await admin
    .from("establishment_contacts")
    .upsert(
      {
        user_id: userId,
        establishment_id: log.establishment_id,
        granted_by: auth.user.id,
      },
      { onConflict: "user_id,establishment_id" },
    );
  if (grantError) {
    return json(500, { error: `Could not record the grant: ${grantError.message}` });
  }

  // Last, because this is the field send-sanitary-order reads: if anything
  // above failed, the order must not start mailing to an address whose owner
  // has no access and no grant on record.
  const { error: estError } = await admin
    .from("establishments")
    .update({
      point_person_email: email,
      point_person_name: log.proposed_point_person_name ?? null,
    })
    .eq("id", log.establishment_id);
  if (estError) {
    return json(500, {
      error: `Access was granted, but recording the address on the ` +
        `establishment failed: ${estError.message}`,
    });
  }

  return json(200, {
    email,
    userId,
    establishmentId: log.establishment_id,
    created,
  });
}
