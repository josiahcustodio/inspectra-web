// [REF: DOMAIN_MODELS]
//
// The shapes the UI works with. These mirror the Firestore documents one-for-one
// (with the inspector document's snake_case field names normalised in
// firestore.ts) and carry no sync bookkeeping: the app is cloud-only, so a
// record either exists in Firestore or it does not exist at all.

export interface Category {
  id: string;
  name: string;
  icon_name: string | null;
  created_at: string | null;
}

export interface ChecklistTemplate {
  id: string;
  item_name: string;
  weight: number | null;
  sub_category: string | null;
  category_id: string | null;
}

export interface Establishment {
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
  // Optional GPS coordinates. Nothing captures these yet — no screen in either
  // client writes them — so in practice they are absent on every record today.
  // The GIS map plots an establishment only when both are present, which is why
  // that map is currently empty rather than showing invented positions.
  latitude?: number | null;
  longitude?: number | null;
}

export interface InspectionLog {
  id: string; // uuid
  establishment_id: string | null; // uuid
  inspector_name: string | null;
  total_demerits: number | null;
  percentage_rating: number | null;
  remarks: string | null;
  inspection_date: string | null;
  photo_evidence_url: string | null;
  // Per-item checklist answers, read straight off the `results` array field on
  // the `inspection_logs` document — the same shape the Flutter client writes,
  // so both clients read and write the same place.
  //
  // Logs written before that convention kept their answers in an
  // `inspection_logs/{id}/inspection_results` sub-collection instead. Those were
  // copied up into the parent `results` field and the sub-collections are now
  // legacy; nothing writes to them, and no screen in this app renders `results`
  // yet, so nothing reads them either.
  results?: any[];
}

// A registered account (`profiles/{uid}`), written by the mobile client on
// first sign-in. Only admins may list this collection — the officer-facing UI
// treats a permission error on it as "source unavailable", not as a failure.
export interface Profile {
  id: string; // auth uid
  role: string; // 'admin' | 'officer'
  email: string;
  created_at: string | null;
}

export interface Inspector {
  id: string;
  name: string;
  inspectorId: string;
  email: string;
  phone: string;
  totalInspections: number;
  completedToday: number;
  status: string;
  performance: string;
  updated_at: string;
}
