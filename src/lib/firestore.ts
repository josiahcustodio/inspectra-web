import { supabase } from "./supabase";
import type {
  Category,
  Establishment,
  InspectionLog,
  Inspector,
  Profile,
} from "./models";

// [REF: CLOUD_DATA_ACCESS]
//
// Every read and write in the admin app goes straight to Supabase (Postgres
// via PostgREST) — there is no local mirror and no push/pull sync step. Reads
// are live subscriptions (see useCollection), so a change made here or by the
// mobile client shows up in the UI as soon as the database acknowledges it.
// Writes fail loudly when the network is down rather than being queued,
// because a queued write with nowhere durable to live is just data loss with
// a delay.
//
// The file keeps its historical name (firestore.ts) so the forty-odd import
// sites didn't churn in the migration commit; the exported surface is
// unchanged. TABLE names are identical to the old Firestore collection names
// — the Postgres schema was created 1:1 (see migration/sql/01_schema.sql).

export const COLLECTIONS = {
  categories: "categories",
  checklistTemplates: "checklist_templates",
  establishments: "establishments",
  inspectionLogs: "inspection_logs",
  inspectors: "inspectors",
  profiles: "profiles",
  // Masterlist import machinery (admin-only in RLS).
  uploadBatches: "upload_batches",
  reviewQueue: "review_queue",
} as const;

// Past permit-years, written by the masterlist importer. Was a Firestore
// sub-collection of establishments/{id}; now a real table keyed on
// (establishment_id, permit_no).
export const PERMITS_TABLE = "establishment_permits";

// ─── Row → model mappers ────────────────────────────────────────────────────
// Passed to useCollection. Kept at module scope so their identity is stable
// across renders. Signature unchanged from the Firestore era: (id, data) —
// useCollection passes (row.id, row).

export const mapCategory = (id: string, data: any): Category => ({
  id,
  name: data.name,
  icon_name: data.icon_name ?? null,
  created_at: data.created_at ?? null,
  sheet_aliases: Array.isArray(data.sheet_aliases) ? data.sheet_aliases : [],
});

// The spread carries any column the Flutter client adds that the web app does
// not know about yet; the explicit lines after it make the declared type true.
// Postgres returns NULL (not undefined) for empty columns, which makes most of
// these normalisations no-ops — they stay as belt-and-braces so the declared
// `| null` types remain honest even if a column goes missing from a select.
// `??` (not `||`) on purpose: a real 0 or "" must survive.
export const mapEstablishment = (id: string, data: any): Establishment => ({
  ...(data as any),
  id,
  business_name: data.business_name ?? "",
  owner_name: data.owner_name ?? null,
  address: data.address ?? null,
  barangay: data.barangay ?? null,
  qr_code_id: data.qr_code_id ?? null,
  created_at: data.created_at ?? null,
  personnel_count: data.personnel_count ?? null,
  personnel_with_hc: data.personnel_with_hc ?? null,
  sanitary_permit_no: data.sanitary_permit_no ?? null,
  control_no: data.control_no ?? null,
  // String(), not a passthrough: the column is text, but historical writes
  // held the NUMBER 1 alongside "1" and "9", and the category filters compare
  // as strings. The load-time transform coerced everything, so this is now
  // insurance rather than a live repair.
  category_id: data.category_id != null ? String(data.category_id) : null,
  category: data.category ?? null,
  business_permit_no: data.business_permit_no ?? null,
  tin: data.tin ?? null,
  group: data.group ?? null,
  masterlist_sheet: data.masterlist_sheet ?? null,
  status: data.status ?? null,
  last_seen_batch_id: data.last_seen_batch_id ?? null,
});

// Every nullable field is normalised rather than left to the spread, because
// `InspectionLog` declares them `| null` and a row served without one would
// otherwise arrive as `undefined` and slip past a `=== null` guard. Five
// separate display bugs traced to exactly that in the Firestore era.
// `??` (not `||`) on purpose: a score of 0 is a real score and must survive.
export const mapInspectionLog = (id: string, data: any): InspectionLog => ({
  ...(data as any),
  id,
  establishment_id: data.establishment_id ?? null,
  category_id: data.category_id != null ? String(data.category_id) : null,
  category_name: data.category_name ?? null,
  inspector_name: data.inspector_name ?? null,
  total_demerits: data.total_demerits ?? null,
  percentage_rating: data.percentage_rating ?? null,
  remarks: data.remarks ?? null,
  inspection_date: data.inspection_date ?? null,
  photo_evidence_url: data.photo_evidence_url ?? null,
  signature_url: data.signature_url ?? null,
  signature_sha256: data.signature_sha256 ?? null,
  results: Array.isArray(data.results) ? data.results : [],
});

// The inspectors table uses snake_case column names (the stored shape both
// clients agreed on); the UI works in camelCase. Normalise on the way in and
// out so the stored shape never drifts.
export const mapInspector = (id: string, data: any): Inspector => ({
  id,
  name: data.name ?? "",
  inspectorId: data.inspector_id ?? "",
  email: data.email ?? "",
  phone: data.phone ?? "",
  status: data.status ?? "Active",
  performance: data.performance ?? "Good",
  totalInspections: data.total_inspections ?? 0,
  completedToday: data.completed_today ?? 0,
  updated_at: data.updated_at ?? "",
});

// Review-queue items written by the masterlist importer. Normalised like the
// others so `=== null` guards and array iteration are safe on old rows.
export const mapReviewQueueItem = (id: string, data: any): import("./models").ReviewQueueItem => ({
  id,
  batch_id: data.batch_id ?? "",
  group: data.group ?? "food",
  status: data.status ?? "pending",
  created_at: data.created_at ?? "",
  decided_at: data.decided_at ?? null,
  sheet_name: data.sheet_name ?? "",
  row_number: data.row_number ?? 0,
  category_id: data.category_id != null ? String(data.category_id) : "",
  row: data.row ?? {},
  candidates: Array.isArray(data.candidates) ? data.candidates : [],
});

// Account rows (`profiles`), created by the handle_new_user() trigger the
// moment an auth user is born — the client-side bootstrap writes of the
// Firebase era are gone. These are the real registered inspector accounts;
// the `inspectors` table above is only the admin-curated directory.
export const mapProfile = (id: string, data: any): Profile => ({
  id,
  role: data.role ?? "officer",
  email: data.email ?? "",
  created_at: data.created_at ?? null,
});

// ─── Writes ─────────────────────────────────────────────────────────────────

// [REF: ESTABLISHMENT_WRITE]
// upsert — PostgREST's ON CONFLICT UPDATE touches only the columns present in
// the payload, which is exactly the old setDoc(..., {merge: true}) contract:
// establishments carry fields (qr_code_id, coordinates, personnel counts) that
// not every client sets on every write, and a full-row write would blank out
// whatever this payload omits.
export async function saveEstablishment(
  id: string | null,
  payload: Partial<Establishment>,
): Promise<string> {
  const rowId = id ?? crypto.randomUUID();
  const { error } = await supabase
    .from(COLLECTIONS.establishments)
    .upsert({ ...payload, id: rowId });
  if (error) throw new Error(error.message);
  return rowId;
}

// [REF: INSPECTOR_WRITE]
export async function saveInspector(
  id: string | null,
  input: Omit<Inspector, "id" | "updated_at">,
): Promise<string> {
  const rowId = id ?? crypto.randomUUID();
  const { error } = await supabase.from(COLLECTIONS.inspectors).upsert({
    id: rowId,
    name: input.name,
    inspector_id: input.inspectorId,
    email: input.email,
    phone: input.phone,
    status: input.status,
    performance: input.performance,
    total_inspections: input.totalInspections,
    completed_today: input.completedToday,
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);
  return rowId;
}

export async function deleteInspector(id: string): Promise<void> {
  const { error } = await supabase
    .from(COLLECTIONS.inspectors)
    .delete()
    .eq("id", id);
  if (error) throw new Error(error.message);
}

// ─── Reads ──────────────────────────────────────────────────────────────────

// [REF: INSPECTION_DETAILS_FETCH_WEB]
// Fetches one inspection log fresh, mirroring the mobile client's
// fetchInspectionDetails. Per-item answers live in the `results` jsonb array
// on the row. The Firestore-era fallback to the legacy inspection_results
// sub-collection is gone: the migration folded any sub-collection answers into
// `results` (and the final export showed zero sub-collection docs anyway).
export async function fetchInspectionDetails(logId: string): Promise<InspectionLog> {
  const { data, error } = await supabase
    .from(COLLECTIONS.inspectionLogs)
    .select("*")
    .eq("id", logId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Inspection record not found.");
  return mapInspectionLog(data.id, data);
}

// No saveInspectionLog here, deliberately: inspection logs are written by
// the mobile client at inspection time; the web admin only reads them. The
// importer's no-write-path-to-inspections rule (runImport.ts) is the same
// invariant from the other side.
