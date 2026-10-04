import { collection, doc, deleteDoc, getDoc, getDocs, setDoc } from "firebase/firestore";
import { firebaseDb } from "./firebase";
import type {
  Category,
  ChecklistTemplate,
  Establishment,
  InspectionLog,
  Inspector,
  Profile,
} from "./models";

// [REF: CLOUD_DATA_ACCESS]
//
// Every read and write in the admin app goes straight to Firestore — there is no
// local mirror and no push/pull sync step. Reads are live subscriptions (see
// useCollection), so a change made here or by the mobile client shows up in the
// UI as soon as Firestore acknowledges it. Writes fail loudly when the network
// is down rather than being queued, because a queued write with nowhere durable
// to live is just data loss with a delay.

export const COLLECTIONS = {
  categories: "categories",
  checklistTemplates: "checklist_templates",
  establishments: "establishments",
  inspectionLogs: "inspection_logs",
  inspectors: "inspectors",
  profiles: "profiles",
  // Masterlist import machinery (admin-only in firestore.rules).
  uploadBatches: "upload_batches",
  reviewQueue: "review_queue",
} as const;

// Sub-collection of establishments/{id}: one document per permit-year,
// written by the masterlist importer. The establishment document carries only
// the CURRENT permit's fields; past years live here.
export const PERMITS_SUBCOLLECTION = "permits";

// ─── Document → model mappers ───────────────────────────────────────────────
// Passed to useCollection. Kept at module scope so their identity is stable
// across renders.

export const mapCategory = (id: string, data: any): Category => ({
  id,
  name: data.name,
  icon_name: data.icon_name ?? null,
  created_at: data.created_at ?? null,
  sheet_aliases: Array.isArray(data.sheet_aliases) ? data.sheet_aliases : [],
});

export const mapChecklistTemplate = (id: string, data: any): ChecklistTemplate => ({
  id,
  item_name: data.item_name,
  weight: data.weight ?? null,
  sub_category: data.sub_category ?? null,
  category_id: data.category_id ?? null,
});

// The spread carries any field the Flutter client adds that the web app does
// not know about yet; the explicit lines after it make the declared type true.
// A document saved without one of these fields arrives as `undefined`, not
// `null` — see mapInspectionLog below for what that cost.
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
  // String(), not a passthrough: production documents hold the NUMBER 1 in
  // this field alongside "1" and "9" (legacy writes). The declared type says
  // string, and the category filters compare it as one — a raw numeric value
  // would silently fall out of every string comparison.
  category_id: data.category_id != null ? String(data.category_id) : null,
  category: data.category ?? null,
  // Masterlist-import fields the matching cascade reads. Normalised here for
  // the same reason as mapInspectionLog below: an absent field must arrive
  // as null, not undefined, so `=== null` guards stay trustworthy.
  business_permit_no: data.business_permit_no ?? null,
  tin: data.tin ?? null,
  group: data.group ?? null,
  masterlist_sheet: data.masterlist_sheet ?? null,
  status: data.status ?? null,
  last_seen_batch_id: data.last_seen_batch_id ?? null,
});

// Every nullable field is normalised rather than left to the spread, because
// `InspectionLog` declares them `| null` and a document saved without one would
// otherwise arrive as `undefined` and slip past a `=== null` guard. Five separate
// display bugs traced to exactly that: a badge reading "Not yet inspected (%)",
// a tile printing "undefined%", a "Scheduled" log labelled "Completed", and two
// more. Normalising here makes the declared type honest, so a call site can
// trust `=== null` — instead of every future reader having to remember not to.
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

// The inspector document uses snake_case field names (the Flutter client writes
// it too); the UI works in camelCase. Normalise on the way in and out so the
// two clients keep agreeing on the stored shape.
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
// others so `=== null` guards and array iteration are safe on old documents.
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

// Account documents written by the mobile client on first sign-in
// (see ensureProfile in the Flutter app's auth_service.dart). These are the
// real registered inspector accounts; the `inspectors` collection above is
// only the admin-curated directory.
export const mapProfile = (id: string, data: any): Profile => ({
  id,
  role: data.role ?? "officer",
  email: data.email ?? "",
  created_at: data.created_at ?? null,
});

// ─── Writes ─────────────────────────────────────────────────────────────────

// [REF: ESTABLISHMENT_WRITE]
// merge: true — establishments carry fields (qr_code_id, coordinates, personnel
// counts) that not every client sets on every write; a plain setDoc would blank
// out whatever this payload omits.
//
// `id` is also stored as a field on the document, not just as the document key,
// because that is the shape the Flutter client reads.
export async function saveEstablishment(
  id: string | null,
  payload: Partial<Establishment>,
): Promise<string> {
  const docId = id ?? crypto.randomUUID();
  await setDoc(
    doc(firebaseDb, COLLECTIONS.establishments, docId),
    { ...payload, id: docId },
    { merge: true },
  );
  return docId;
}

// [REF: INSPECTOR_WRITE]
export async function saveInspector(
  id: string | null,
  input: Omit<Inspector, "id" | "updated_at">,
): Promise<string> {
  const docId = id ?? crypto.randomUUID();
  await setDoc(
    doc(firebaseDb, COLLECTIONS.inspectors, docId),
    {
      id: docId,
      name: input.name,
      inspector_id: input.inspectorId,
      email: input.email,
      phone: input.phone,
      status: input.status,
      performance: input.performance,
      total_inspections: input.totalInspections,
      completed_today: input.completedToday,
      updated_at: new Date().toISOString(),
    },
    { merge: true },
  );
  return docId;
}

export async function deleteInspector(id: string): Promise<void> {
  await deleteDoc(doc(firebaseDb, COLLECTIONS.inspectors, id));
}

// ─── Reads ──────────────────────────────────────────────────────────────────

// [REF: INSPECTION_DETAILS_FETCH_WEB]
// Fetches one inspection log fresh from Firestore, mirroring the mobile
// client's fetchInspectionDetails: per-item answers live in the `results`
// array on the document, but logs written before that convention kept them in
// an `inspection_results` sub-collection, so fall back to reading that when
// the array is absent.
export async function fetchInspectionDetails(logId: string): Promise<InspectionLog> {
  const snap = await getDoc(doc(firebaseDb, COLLECTIONS.inspectionLogs, logId));
  if (!snap.exists()) {
    throw new Error("Inspection record not found.");
  }

  const log = mapInspectionLog(snap.id, snap.data());
  if (log.results && log.results.length > 0) return log;

  const legacy = await getDocs(
    collection(firebaseDb, COLLECTIONS.inspectionLogs, logId, "inspection_results"),
  );
  return { ...log, results: legacy.docs.map((d) => d.data()) };
}

export async function saveInspectionLog(
  id: string | null,
  payload: Partial<InspectionLog>,
): Promise<string> {
  const docId = id ?? crypto.randomUUID();
  await setDoc(
    doc(firebaseDb, COLLECTIONS.inspectionLogs, docId),
    { ...payload, id: docId },
    { merge: true },
  );
  return docId;
}
