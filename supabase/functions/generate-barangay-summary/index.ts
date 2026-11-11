// [REF: AI_BARANGAY_SUMMARY]
//
// POST /functions/v1/generate-barangay-summary
// Body (all optional): { "from": ISO, "to": ISO, "barangays": ["Alangilan"] }
// Returns: { narrative, from, to, city, barangays, scope_barangays }
//
// Turns the inspection_logs of a date range into the data for a barangay-level
// compliance report: SQL-side data is aggregated here (counts, rating bands,
// recurring failed checklist items), then ONE Claude call writes the narrative.
// The hard numbers are computed in aggregate.ts, never by the model — the model
// only phrases them and reads the free-text inspector notes. The browser lays
// both out as a PDF (src/lib/complianceReportPdf.ts).
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
import { aggregate, BarangaySummary, EstablishmentRow, LogRow, logBarangayResolver } from "./aggregate.ts";

// Browser calls (supabase.functions.invoke) are cross-origin preflighted.
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DEFAULT_WINDOW_DAYS = 90;
const MAX_WINDOW_DAYS = 366; // Same limit as src/lib/complianceReportScope.ts.
const DAY_MS = 24 * 60 * 60 * 1000;
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
async function fetchAllRows<T>(db: SupabaseClient, table: string, columns: string, dates?: { from: string; to: string }): Promise<T[]> {
  const PAGE = 1000;
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    let query = db.from(table).select(columns).order("id").range(from, from + PAGE - 1);
    // gte also drops NULL inspection_date rows — a dateless log can't be
    // attributed to the reporting window, so excluding it is the honest call.
    if (dates) query = query.gte("inspection_date", dates.from).lte("inspection_date", dates.to);
    const { data, error } = await query;
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...((data ?? []) as T[]));
    if (!data || data.length < PAGE) return rows;
  }
}

function buildPrompt(city: BarangaySummary, detailed: BarangaySummary[], rest: BarangaySummary[], from: string, to: string, scope: string[] | null): string {
  // The model writes prose only. Every number it may cite is in this digest;
  // the system prompt forbids inventing anything beyond it.
  const digest = {
    reporting_window: { from, to },
    scope: scope ? { selected_barangays_only: scope } : "all barangays with inspections",
    rating_scale:
      "Scores are 0-100. Bands: 90-100 Excellent, 70-89 Very Satisfactory, " +
      "0-69 Satisfactory. CAUTION: despite the name, 'Satisfactory' is the " +
      "LOWEST band and means non-passing / high-risk in this system.",
    city_wide: {
      inspections: city.inspections,
      establishments_inspected: city.establishments_inspected,
      barangays: detailed.length + rest.length,
      average_rating: city.average_rating,
      bands: city.bands,
      top_failed_items: city.top_failed_items,
      lowest_rated: city.lowest_rated,
    },
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
- "city_wide" totals only the barangays in "scope". When scope is selected barangays, write about those barangays only: never present the totals as the whole city's, and never compare them with barangays outside the scope.
- Fill the fields of the required JSON format. The tables and charts around your prose already show every figure, so interpret the data rather than reciting it.
- executive_summary is exactly five sentences for a busy health officer: overall compliance, where the risk is concentrated, the most common violations, the data's limits if any, and what to do next.
- citywide_findings is one paragraph on the patterns across barangays.
- barangays has one entry per barangay in "barangays_detailed", in the same order, with "name" copied exactly. Each assessment is at most 70 words: what stands out and anything notable from the inspector notes.
- other_barangays is one compact paragraph covering "barangays_other", or an empty string if there are none.
- recommended_actions lists 3 to 6 follow-ups grounded in the data, highest priority first.
- Plain sentences only — no markdown symbols, because the text is typeset as-is into a PDF.`;

// Every field is required so the PDF layout never has to handle a missing
// section. Numbers are deliberately absent: those come from aggregate.ts.
const NARRATIVE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["executive_summary", "citywide_findings", "barangays", "other_barangays", "recommended_actions"],
  properties: {
    executive_summary: { type: "string" },
    citywide_findings: { type: "string" },
    barangays: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "assessment"],
        properties: { name: { type: "string" }, assessment: { type: "string" } },
      },
    },
    other_barangays: { type: "string" },
    recommended_actions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["priority", "barangay", "action", "rationale"],
        properties: {
          priority: { type: "string", enum: ["High", "Medium", "Low"] },
          barangay: { type: "string" },
          action: { type: "string" },
          rationale: { type: "string" },
        },
      },
    },
  },
};

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

  let body: { from?: string; to?: string; barangays?: string[] } = {};
  try {
    if (req.headers.get("content-type")?.includes("application/json")) body = await req.json();
  } catch {
    // An unreadable body just means "use the defaults".
  }
  const to = body.to ? new Date(body.to) : new Date();
  const from = body.from ? new Date(body.from) : new Date(to.getTime() - DEFAULT_WINDOW_DAYS * DAY_MS);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) {
    return json(400, { error: "Choose a valid date range." });
  }
  if (to.getTime() - from.getTime() > MAX_WINDOW_DAYS * DAY_MS) {
    return json(400, { error: `Choose a date range of up to ${MAX_WINDOW_DAYS} days.` });
  }
  const scope = body.barangays ?? null;
  if (scope !== null && (!Array.isArray(scope) || scope.some((b) => typeof b !== "string"))) {
    return json(400, { error: "Barangays must be a list of names." });
  }

  const [rangeLogs, establishments] = await Promise.all([
    fetchAllRows<LogRow>(
      db,
      "inspection_logs",
      "establishment_id, establishment_name, percentage_rating, remarks, inspection_date, results",
      { from: from.toISOString(), to: to.toISOString() },
    ),
    // address is fetched only for the legacy-barangay fallback in aggregate.ts.
    fetchAllRows<EstablishmentRow>(db, "establishments", "id, business_name, barangay, address"),
  ]);

  const barangayOfLog = logBarangayResolver(establishments);
  const logs = scope ? rangeLogs.filter((log) => scope.includes(barangayOfLog(log))) : rangeLogs;
  const summaries = aggregate(logs, establishments);
  if (summaries.length === 0) {
    return json(422, { error: "No inspections match this date range and these barangays." });
  }
  // With no establishments every log lands in one bucket: the city-wide totals,
  // averaged over raw scores rather than the barangays' rounded averages.
  const [city] = aggregate(logs, []);

  const detailed = summaries.slice(0, DETAILED_BARANGAYS);
  const rest = summaries.slice(DETAILED_BARANGAYS);

  const anthropic = new Anthropic(); // reads ANTHROPIC_API_KEY from env
  const response = await anthropic.beta.messages.create({
    // Opus 5.5 for report prose; swap to "claude-sonnet-5-5" if cost ever matters
    // more than writing quality (keeps fallbacks). Haiku would need betas/fallbacks
    // dropped — it has no server-side fallback.
    model: "claude-opus-5-5",
    max_tokens: 16000,
    // Server-side fallback: if a safety classifier ever declines (it shouldn't
    // for sanitation data, but the failure mode is a blank report), the API
    // retries on the recommended fallback model inside the same call.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    // Opus 5.5 defaults to "medium"; grounding an official report earns "high".
    output_config: { effort: "high", format: { type: "json_schema", schema: NARRATIVE_SCHEMA } },
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildPrompt(city, detailed, rest, from.toISOString(), to.toISOString(), scope) }],
  });

  if (response.stop_reason === "refusal") {
    return json(502, { error: "The AI declined to generate this report. Please try again or contact the administrator." });
  }
  // Cut-off output is unparseable JSON, not just a shorter report.
  if (response.stop_reason === "max_tokens") {
    return json(502, { error: "The AI report ran too long. Please try again." });
  }
  const text = response.content.find((b) => b.type === "text")?.text;
  if (!text) return json(502, { error: "The AI returned an empty report. Please try again." });

  return json(200, {
    // Not "report": dashboards still open on the old bundle render that field
    // directly, and an object there would crash them instead of showing nothing.
    narrative: JSON.parse(text),
    from: from.toISOString(),
    to: to.toISOString(),
    city,
    barangays: summaries,
    scope_barangays: scope,
  });
}
