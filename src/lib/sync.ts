import { db } from "./db";
import { supabase } from "./supabase";

export async function pushToSupabase() {
  try {
    // 1. Get all unsynced records from local Dexie
    const unsyncedEstablishments = await db.establishments.where('is_synced').equals(0).toArray();
    const unsyncedInspections = await db.inspections.where('is_synced').equals(0).toArray();
    const unsyncedInspectors = await db.inspectors.where('is_synced').equals(0).toArray();

    // 2. Push Establishments
    if (unsyncedEstablishments.length > 0) {
      const { error } = await supabase.from('establishments').upsert(
        unsyncedEstablishments.map(e => {
          const { is_synced, ...rest } = e;
          return rest;
        })
      );
      if (!error) {
        // Mark as synced locally
        await db.transaction('rw', db.establishments, async () => {
          for (const e of unsyncedEstablishments) {
            await db.establishments.update(e.id, { is_synced: 1 });
          }
        });
      }
    }

    // 3. Push Inspections
    if (unsyncedInspections.length > 0) {
      const { error } = await supabase.from('inspections').upsert(
        unsyncedInspections.map(i => {
          const { is_synced, ...rest } = i;
          return rest;
        })
      );
      if (!error) {
        await db.transaction('rw', db.inspections, async () => {
          for (const i of unsyncedInspections) {
            await db.inspections.update(i.id, { is_synced: 1 });
          }
        });
      }
    }

    // 4. Push Inspectors
    if (unsyncedInspectors.length > 0) {
      const { error } = await supabase.from('inspectors').upsert(
        unsyncedInspectors.map(i => {
          const { is_synced, ...rest } = i;
          return rest;
        })
      );
      if (!error) {
        await db.transaction('rw', db.inspectors, async () => {
          for (const i of unsyncedInspectors) {
            await db.inspectors.update(i.id, { is_synced: 1 });
          }
        });
      }
    }

    console.log("Push to Supabase complete.");
  } catch (error) {
    console.error("Error pushing to Supabase:", error);
  }
}

export async function pullFromSupabase() {
  try {
    // 1. Pull Establishments
    const { data: estData, error: estError } = await supabase.from('establishments').select('*');
    if (!estError && estData) {
      const dbReadyEst = estData.map(e => ({ ...e, is_synced: 1 }));
      await db.establishments.bulkPut(dbReadyEst);
    } else if (estError) {
      console.error("Error pulling establishments:", estError.message);
    }

    // 2. Pull Inspections
    const { data: inspData, error: inspError } = await supabase.from('inspections').select('*');
    if (!inspError && inspData) {
      const dbReadyInsp = inspData.map(i => ({ ...i, is_synced: 1 }));
      await db.inspections.bulkPut(dbReadyInsp);
    }

    // 3. Pull Inspectors
    const { data: inspectorData, error: inspectorError } = await supabase.from('inspectors').select('*');
    if (!inspectorError && inspectorData) {
      const dbReadyInspectors = inspectorData.map(i => ({ ...i, is_synced: 1 }));
      await db.inspectors.bulkPut(dbReadyInspectors);
    }

    console.log("Pull from Supabase complete.");
  } catch (error) {
    console.error("Error pulling from Supabase:", error);
  }
}

export async function syncAll() {
  if (!navigator.onLine) return;
  
  console.log("Starting background sync...");
  await pushToSupabase();
  await pullFromSupabase();
  console.log("Background sync finished.");
}
