// [REF: AI_BARANGAY_SUMMARY]
//
// POST /functions/v1/generate-barangay-summary
// Body (all optional): { "days": 90, "barangay": "Alangilan" }
// Returns: { report, from, to, inspections, barangays }
//
// Turns the inspection_logs of the last N days into a plain-text, barangay-level
// compliance report: SQL-side data is aggregated here (counts, rating bands,
// recurring failed checklist items), then ONE Claude call writes the narrative.
// The hard numbers are computed in aggregate.ts, never by the model — the model
// only phrases them and reads the free-text inspector notes.
//
// Security stance:
//  - ANTHROPIC_API_KEY lives only in Supabase secrets; the browser never sees it.
//  - Table reads run under the CALLER's JWT (no service-role key), so RLS
//    applies exactly as it does for the dashboard. If the dashboard can't read
//    a row, neither can this function.
//  - The web app's CSP already allows the Supabase origin, and Edge Functions
//    are served from that same origin — no CSP change needed.
//
// Deploy:   supabase functions deploy generate-barangay-summary
// Secrets:  supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
// Test:     deno test supabase/functions/generate-barangay-summary/

import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk";
import { aggregate, BarangaySummary, EstablishmentRow, LogRow } from "./aggregate.ts";

// Browser calls (supabase.functions.invoke) are cross-origin preflighted.
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DEFAULT_WINDOW_DAYS = 90;
// Full narrative sections only for the busiest barangays; the rest get a
// one-line mention. Keeps the report readable and the output bounded no matter
// how many barangays had inspections.
const DETAILED_BARANGAYS = 15;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });

// Same pager as src/lib/supabase.ts fetchAllRows, same reason: PostgREST caps a
// response at 1000 rows and a bare select would silently truncate. order('id')
// keeps the pages deterministic under concurrent writes.
async function fetchAllRows<T>(db: SupabaseClient, table: string, columns: string, sinceDate?: string): Promise<T[]> {
  const PAGE = 1000;
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    let query = db.from(table).select(columns).order("id").range(from, from + PAGE - 1);
    // gte also drops NULL inspection_date rows — a dateless log can't be
    // attributed to the reporting window, so excluding it is the honest call.
    if (sinceDate) query = query.gte("inspection_date", sinceDate);
    const { data, error } = await query;
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...((data ?? []) as T[]));
    if (!data || data.length < PAGE) return rows;
  }
}

function buildPrompt(detailed: BarangaySummary[], rest: BarangaySummary[], from: string, to: string): string {
  // The model writes prose only. Every number it may cite is in this digest;
  // the system prompt forbids inventing anything beyond it.
  const digest = {
    reporting_window: { from, to },
    rating_scale:
      "Scores are 0-100. Bands: 90-100 Excellent, 70-89 Very Satisfactory, " +
      "0-69 Satisfactory. CAUTION: despite the name, 'Satisfactory' is the " +
      "LOWEST band and means non-passing / high-risk in this system.",
    barangays_detailed: detailed,
    barangays_other: rest.map((b) => ({
      name: b.name,
      inspections: b.inspections,
      average_rating: b.average_rating,
    })),
  };
  return JSON.stringify(digest);
}

const SYSTEM_PROMPT = `You write barangay-level sanitary compliance reports for the City Health Office of Batangas City, Philippines. The reader is a sanitary inspector or health officer, not a programmer.

You will receive a JSON digest of inspection data. Write a report from it, following these rules:

- Use ONLY the numbers and notes in the digest. Never invent figures, establishment names, or trends the data does not show. If the data for a barangay is thin (few inspections, no notes), say so plainly instead of padding.
- "Satisfactory" (0-69) is the LOWEST rating band in this system — treat those scores as failing / high-risk, never as acceptable.
- Structure: a short city-wide OVERVIEW first, then one section per barangay in "barangays_detailed" (busiest first), then a single compact paragraph or list covering "barangays_other". For each detailed barangay: inspection coverage, average rating, recurring violations (the top failed checklist items), worst-performing establishments, and anything notable from the inspector notes.
- End with a short RECOMMENDED ACTIONS section: which barangays need follow-up visits and why, grounded in the data.
- Plain text only — no markdown symbols (no #, *, |). Use CAPITALISED headings and blank lines for structure, because the output is rendered verbatim in a plain-text viewer.
- Open with the reporting window, and close with one line noting this is an AI-drafted summary for review by the sanitary office, not an official record.`;

Deno.serve(async (req) => {
  // Without this the Edge Runtime turns any throw into a bodyless
  // "500 Internal Server Error", which tells the operator nothing — a missing
  // ANTHROPIC_API_KEY and a broken SQL query look identical.
  try {
    return await handle(req);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("generate-barangay-summary failed:", message);
    return json(500, { error: message });
  }
});

async function handle(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json(405, { error: "POST only" });

  // Authenticate the caller and reuse their JWT for all table reads.
  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } },
  );
  const { data: auth } = await db.auth.getUser();
  if (!auth?.user) return json(401, { error: "Sign in to generate reports." });

  let body: { days?: number; barangay?: string } = {};
  try {
    if (req.headers.get("content-type")?.includes("application/json")) body = await req.json();
  } catch {
    // An unreadable body just means "use the defaults".
  }
  const days = Number.isFinite(body.days) && body.days! > 0 ? Math.min(body.days!, 366) : DEFAULT_WINDOW_DAYS;
  const to = new Date();
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);

  const [logs, establishments] = await Promise.all([
    fetchAllRows<LogRow>(
      db,
      "inspection_logs",
      "establishment_id, establishment_name, percentage_rating, remarks, inspection_date, results",
      from.toISOString(),
    ),
    // address is fetched only for the legacy-barangay fallback in aggregate.ts.
    fetchAllRows<EstablishmentRow>(db, "establishments", "id, business_name, barangay, address"),
  ]);

  let summaries = aggregate(logs, establishments);
  if (body.barangay) {
    const wanted = body.barangay.trim().toLowerCase();
    summaries = summaries.filter((b) => b.name.toLowerCase() === wanted);
  }
  if (summaries.length === 0) {
    return json(422, {
      error: body.barangay
        ? `No inspections found for "${body.barangay}" in the last ${days} days.`
        : `No inspections recorded in the last ${days} days.`,
    });
  }

  const detailed = summaries.slice(0, DETAILED_BARANGAYS);
  const rest = summaries.slice(DETAILED_BARANGAYS);

  const anthropic = new Anthropic(); // reads ANTHROPIC_API_KEY from env
  const response = await anthropic.beta.messages.create({
    // Opus 5 for report prose; swap to "claude-haiku-4-5" if cost ever matters
    // more than writing quality (also drop betas/fallbacks then — Haiku has no
    // safety-classifier refusals to fall back from).
    model: "claude-opus-5",
    max_tokens: 8000,
    // Server-side fallback: if a safety classifier ever declines (it shouldn't
    // for sanitation data, but the failure mode is a blank report), the API
    // retries on the recommended fallback model inside the same call.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildPrompt(detailed, rest, from.toISOString(), to.toISOString()) }],
  });

  if (response.stop_reason === "refusal") {
    return json(502, { error: "The AI declined to generate this report. Please try again or contact the administrator." });
  }
  const report = response.content.find((b) => b.type === "text")?.text;
  if (!report) return json(502, { error: "The AI returned an empty report. Please try again." });

  return json(200, {
    report,
    from: from.toISOString(),
    to: to.toISOString(),
    inspections: logs.length,
    barangays: summaries.length,
  });
}
