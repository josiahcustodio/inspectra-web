import { db as localDb } from "./db";
import { firebaseDb, auth } from "./firebase";
import { collection, getDocs, doc, setDoc, writeBatch } from "firebase/firestore";

// ─── Inspection Results ─────────────────────────────────────────────────────
// Shared contract with the mobile client (see SyncService._submitOfflineResults
// in the Flutter app): per-item checklist answers are individual docs in
// `inspection_logs/{logId}/inspection_results`, keyed by checklist_item_id.
// They are never embedded as a field on the parent `inspection_logs` doc.

async function pushInspectionResults(logId: string, results: any[]) {
  if (!results || results.length === 0) return;
  const batch = writeBatch(firebaseDb);
  const resultsCollection = collection(firebaseDb, 'inspection_logs', logId, 'inspection_results');
  for (const result of results) {
    const itemId = result.checklist_item_id ?? result.id;
    if (!itemId) continue;
    batch.set(doc(resultsCollection, itemId), result, { merge: true });
  }
  await batch.commit();
}

async function fetchInspectionResults(logId: string) {
  const snapshot = await getDocs(collection(firebaseDb, 'inspection_logs', logId, 'inspection_results'));
  return snapshot.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
}

export async function pushToFirebase() {
  try {
    // 1. Get all unsynced records from local Dexie
    const unsyncedEstablishments = await localDb.establishments.where('is_synced').equals(0).toArray();
    const unsyncedInspectionLogs = await localDb.inspection_logs.where('is_synced').equals(0).toArray();

    // 2. Push Establishments
    // merge: true — establishments carry fields (category_id, barangay, qr_code_id)
    // that not every client sets on every write; a plain setDoc would blank out
    // whatever fields this payload omits.
    if (unsyncedEstablishments.length > 0) {
      await Promise.all(unsyncedEstablishments.map(async (e) => {
        const { is_synced, ...rest } = e;
        await setDoc(doc(firebaseDb, 'establishments', e.id), rest, { merge: true });
      }));
      // Mark as synced locally
      await localDb.transaction('rw', localDb.establishments, async () => {
        for (const e of unsyncedEstablishments) {
          await localDb.establishments.update(e.id, { is_synced: 1 });
        }
      });
    }

    // 3. Push Inspection Logs
    // Per-item checklist answers live in the `inspection_results` sub-collection —
    // the same schema the mobile client writes to. `results` is local-only
    // staging (see db.ts) and must never land as a field on the parent doc,
    // so it's stripped out of `rest` before the parent write.
    if (unsyncedInspectionLogs.length > 0) {
      await Promise.all(unsyncedInspectionLogs.map(async (i) => {
        const { is_synced, results, ...rest } = i;
        await setDoc(doc(firebaseDb, 'inspection_logs', i.id), rest, { merge: true });
        await pushInspectionResults(i.id, results ?? []);
      }));
      await localDb.transaction('rw', localDb.inspection_logs, async () => {
        for (const i of unsyncedInspectionLogs) {
          await localDb.inspection_logs.update(i.id, { is_synced: 1 });
        }
      });
    }

    // 4. Push Inspectors
    const unsyncedInspectors = await localDb.inspectors.where('is_synced').equals(0).toArray();
    if (unsyncedInspectors.length > 0) {
      await Promise.all(unsyncedInspectors.map(async (i) => {
        await setDoc(doc(firebaseDb, 'inspectors', i.id), {
          id: i.id,
          name: i.name,
          inspector_id: i.inspectorId,
          email: i.email,
          phone: i.phone,
          status: i.status,
          performance: i.performance,
          total_inspections: i.totalInspections,
          completed_today: i.completedToday,
          updated_at: i.updated_at,
        }, { merge: true });
      }));
      await localDb.transaction('rw', localDb.inspectors, async () => {
        for (const i of unsyncedInspectors) {
          await localDb.inspectors.update(i.id, { is_synced: 1 });
        }
      });
    }

    console.log("Push to Firebase complete.");
  } catch (error) {
    console.error("Error pushing to Firebase:", error);
  }
}

// Runs one pull step in isolation — a failure here (denied rule, transient
// network error) must not abort the remaining, unrelated collection pulls.
async function safePull(label: string, fn: () => Promise<void>) {
  try {
    await fn();
  } catch (error) {
    console.error(`Error pulling ${label} from Firebase:`, error);
  }
}

export async function pullFromFirebase() {
  // Collect IDs of locally-pending records to avoid overwriting them with stale remote data
  const pendingEstIds = new Set(
    (await localDb.establishments.where('is_synced').equals(0).toArray()).map(e => e.id)
  );
  const pendingInspIds = new Set(
    (await localDb.inspection_logs.where('is_synced').equals(0).toArray()).map(i => i.id)
  );
  const pendingInspectorIds = new Set(
    (await localDb.inspectors.where('is_synced').equals(0).toArray()).map(i => i.id)
  );

  // 1. Pull Establishments — skip any whose local version is still pending sync
  await safePull('establishments', async () => {
    const estSnapshot = await getDocs(collection(firebaseDb, 'establishments'));
    const estData = estSnapshot.docs
      .map(doc => ({ id: doc.id, ...(doc.data() as any) }))
      .filter(e => !pendingEstIds.has(e.id));
    if (estData.length > 0) {
      const dbReadyEst = estData.map(e => ({ ...e, is_synced: 1 }));
      await localDb.establishments.bulkPut(dbReadyEst);
    }
  });

  // 2. Pull Inspection Logs — skip pending
  // Each log's checklist answers are fetched from its `inspection_results`
  // sub-collection and re-attached as the local `results` field (local-only
  // staging shape — see db.ts). This is an extra read per log on top of the
  // parent fetch; same N+1 cost already flagged for this polling loop in
  // SYSTEM_AUDIT.md §2.2.4, not a new issue introduced here.
  await safePull('inspection logs', async () => {
    const inspSnapshot = await getDocs(collection(firebaseDb, 'inspection_logs'));
    const inspData = inspSnapshot.docs
      .map(doc => ({ id: doc.id, ...(doc.data() as any) }))
      .filter(i => !pendingInspIds.has(i.id));
    if (inspData.length > 0) {
      const dbReadyInsp = await Promise.all(inspData.map(async (i) => ({
        ...i,
        results: await fetchInspectionResults(i.id),
        is_synced: 1,
      })));
      await localDb.inspection_logs.bulkPut(dbReadyInsp);
    }
  });

  // 3. Pull Categories (reference data — no local edits possible)
  await safePull('categories', async () => {
    const catSnapshot = await getDocs(collection(firebaseDb, 'categories'));
    const catData = catSnapshot.docs.map(doc => ({ id: doc.id, ...(doc.data() as any) }));
    if (catData.length > 0) {
      await localDb.categories.bulkPut(catData);
    }
  });

  // 4. Pull Checklist Templates (reference data)
  await safePull('checklist templates', async () => {
    const checkSnapshot = await getDocs(collection(firebaseDb, 'checklist_templates'));
    const checkData = checkSnapshot.docs.map(doc => ({ id: doc.id, ...(doc.data() as any) }));
    if (checkData.length > 0) {
      await localDb.checklist_templates.bulkPut(checkData);
    }
  });

  // 5. Pull Inspectors — skip any whose local version is still pending sync
  await safePull('inspectors', async () => {
    const inspectorSnapshot = await getDocs(collection(firebaseDb, 'inspectors'));
    const inspectorData = inspectorSnapshot.docs
      .map(doc => ({ id: doc.id, ...(doc.data() as any) }))
      .filter(i => !pendingInspectorIds.has(i.id));
    if (inspectorData.length > 0) {
      const dbReadyInspectors = inspectorData.map(i => ({
        ...i,
        id: i.id,
        name: i.name,
        inspectorId: i.inspector_id,
        email: i.email,
        phone: i.phone,
        status: i.status,
        performance: i.performance,
        totalInspections: i.total_inspections,
        completedToday: i.completed_today,
        updated_at: i.updated_at,
        is_synced: 1,
      }));
      await localDb.inspectors.bulkPut(dbReadyInspectors);
    }
  });

  console.log('Pull from Firebase complete.');
}

export async function syncAll() {
  if (!navigator.onLine) return;
  const user = auth.currentUser;
  if (!user) return; // Skip sync if not logged in

  // A sync triggered right after a fresh sign-in (e.g. the focus/visibility
  // listeners in SyncProvider) can race Firestore's internal auth-credential
  // listener: auth.currentUser is already set, but Firestore hasn't yet
  // picked up the new token, so getDocs() below comes back permission-denied
  // even though the security rules allow it. Forcing a token fetch is a real
  // round-trip that only resolves once that credential state has settled.
  try {
    await user.getIdToken();
  } catch {
    return;
  }

  console.log("Starting background sync...");
  await pushToFirebase();
  await pullFromFirebase();
  console.log("Background sync finished.");
}
