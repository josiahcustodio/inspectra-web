import Dexie, { Table } from "dexie";

// Define the shape of our Dexie tables

export interface DbCategory {
  id: string;
  name: string;
  icon_name: string | null;
  created_at: string | null;
}

export interface DbChecklistTemplate {
  id: string;
  item_name: string;
  weight: number | null;
  sub_category: string | null;
  category_id: string | null;
}

export interface DbEstablishment {
  id: string; // uuid
  business_name: string;
  owner_name: string | null;
  address: any;
  barangay: string | null;
  qr_code_id: string | null;
  created_at: string | null;
  personnel_count: number | null;
  personnel_with_hc: number | null;
  sanitary_permit_no: string | null;
  control_no: string | null;
  category_id: string | null;
  category: string | null;
  is_synced: number; // 0 or 1
}

export interface DbInspectionLog {
  id: string; // uuid
  establishment_id: string | null; // uuid
  inspector_name: string | null;
  total_demerits: number | null;
  percentage_rating: number | null; // numeric mapped to number
  remarks: string | null;
  inspection_date: string | null;
  photo_evidence_url: string | null;
  // Local-only staging for per-item checklist answers. NEVER written as a field
  // on the Firestore `inspection_logs` doc — sync.ts pushes/pulls this through
  // the `inspection_results` sub-collection instead, matching the mobile client.
  results?: any[];
  is_synced: number; // 0 or 1
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
  is_synced: number;
  updated_at: string;
}

// Subclass Dexie
export class ClowtecDB extends Dexie {
  categories!: Table<DbCategory>;
  checklist_templates!: Table<DbChecklistTemplate>;
  establishments!: Table<DbEstablishment>;
  inspection_logs!: Table<DbInspectionLog>;
  inspectors!: Table<DbInspector>;

  constructor() {
    super("ClowtecDB");
    
    // Define the schema (indexes)
    this.version(8).stores({
      categories: "id, name",
      checklist_templates: "id, category_id",
      establishments: "id, business_name, barangay, is_synced",
      inspection_logs: "id, establishment_id, inspector_name, is_synced, inspection_date",
      inspectors: "id, inspectorId, status, is_synced",
    });
  }
}

// Export a singleton instance of the database
export const db = new ClowtecDB();
