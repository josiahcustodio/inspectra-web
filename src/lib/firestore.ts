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
} as const;

// ─── Document → model mappers ───────────────────────────────────────────────
// Passed to useCollection. Kept at module scope so their identity is stable
// across renders.

export const mapCategory = (id: string, data: any): Category => ({
  id,
  name: data.name,
  icon_name: data.icon_name ?? null,
  created_at: data.created_at ?? null,
});

export const mapChecklistTemplate = (id: string, data: any): ChecklistTemplate => ({
  id,
  item_name: data.item_name,
  weight: data.weight ?? null,
  sub_category: data.sub_category ?? null,
  category_id: data.category_id ?? null,
});

export const mapEstablishment = (id: string, data: any): Establishment => ({
  ...(data as any),
  id,
});

export const mapInspectionLog = (id: string, data: any): InspectionLog => ({
  ...(data as any),
  id,
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
