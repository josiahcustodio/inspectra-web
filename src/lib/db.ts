import Dexie, { Table } from "dexie";

// Define the shape of our Dexie tables

export interface DbEstablishment {
  id: string; // use UUIDs in sync with Supabase
  business_name: string;
  owner_name: string | null;
  address: string | null;
  qr_code_id: string | null;
  created_at: string;
  personnel_count: number | null;
  personnel_with_hc: number | null;
  sanitary_permit_no: string | null;
  control_no: string | null;
  category_id: string | null;
  is_synced: number; // 0 or 1
}

export interface DbInspection {
  id: string; // use UUIDs
  establishment_id: string;
  inspector_id: string;
  date: string;
  time: string;
  score: number | null;
  grade: string | null;
  status: string;
  is_synced: number; // 0 or 1
  updated_at: string;
}

export interface DbInspector {
  id: string;
  name: string;
  inspectorId: string;
  email: string;
  phone: string;
  totalInspections: number;
  completedToday: number;
  status: string;
  performance: string;
  is_synced: number; // 0 or 1
  updated_at: string;
}

// Subclass Dexie
export class ClowtecDB extends Dexie {
  establishments!: Table<DbEstablishment>;
  inspections!: Table<DbInspection>;
  inspectors!: Table<DbInspector>;

  constructor() {
    super("ClowtecDB");
    
    // Define the schema (indexes)
    this.version(4).stores({
      establishments: "id, business_name, is_synced",
      inspections: "id, establishment_id, inspector_id, status, is_synced, date, grade",
      inspectors: "id, inspectorId, status, is_synced",
    });
  }
}

// Export a singleton instance of the database
export const db = new ClowtecDB();
