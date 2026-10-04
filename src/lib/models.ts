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
  // Excel sheet names this category has been matched to by past masterlist
  // imports ("SariSariStoreA", "SariSariStore B", ...), so the next upload
  // maps those sheets automatically. Absent on categories never imported into.
  sheet_aliases?: string[];
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

  // ── Masterlist fields ──────────────────────────────────────────────────
  // Written by the Excel importer (pages/MasterlistImport.tsx); all optional
  // because every record created before the importer existed lacks them.
  // `business_permit_no` is the business (mayor's) permit from the masterlist
  // — deliberately a separate field from `sanitary_permit_no`, which is a
  // different document issued by the sanitation office itself.
  business_permit_no?: string | null;
  applic_type?: string | null; // "new" | "renewal", as the masterlist spells it
  permit_date_issued?: string | null; // "YYYY-MM-DD"
  line_of_business?: string | null;
  floor_area_sqm?: number | null;
  tel_no?: string | null;
  tin?: string | null;
  group?: "food" | "non_food" | null; // which masterlist workbook it belongs to
  // Which sheet of the workbook this record last appeared on ("Bakery",
  // "SariSariStoreA"). Import bookkeeping, NOT a category: the importer
  // scopes its duplicate-detection by sheet, since a renewal reappears on
  // the same sheet it was on last year.
  masterlist_sheet?: string | null;

  // The masterlist's own DATE INSPECTED / SSSR / REMARKS columns, kept for
  // reference only. The live values shown in the UI always come from
  // inspection_logs — these never overwrite inspection progress.
  import_date_inspected?: string | null;
  import_sssr?: string | null;
  import_remarks?: string | null;

  // "active" | "delisted". Businesses missing from a newer masterlist are
  // delisted (hidden from mobile), never deleted — their inspection history
  // must survive.
  status?: string | null;
  last_seen_batch_id?: string | null;
  source_batch_id?: string | null;
  updated_at?: string | null;
}

export interface InspectionLog {
  id: string; // uuid
  establishment_id: string | null; // uuid
  // Which checklist this inspection was scored against (the mobile client
  // writes both the category doc id and its denormalised name). This is
  // where an establishment's CATEGORY comes from in this system —
  // categorisation happens at inspection time, never at masterlist import.
  category_id?: string | null;
  category_name?: string | null;
  inspector_name: string | null;
  total_demerits: number | null;
  percentage_rating: number | null;
  remarks: string | null;
  inspection_date: string | null;
  photo_evidence_url: string | null;
  // The inspector's sign-off, captured on the phone's signature pad and
  // uploaded to Storage at signatures/{establishment_id}/{log_id}.png. This is
  // a download URL, so it can be fetched directly; the hash is what proves the
  // image is the one captured at the inspection. Written by the Flutter client
  // (see signaturePath in its sync_service.dart); absent on any log recorded
  // before sign-off existed, and on one whose upload has not caught up yet.
  signature_url?: string | null;
  signature_sha256?: string | null;
  // Per-item checklist answers, read straight off the `results` array field on
  // the `inspection_logs` document — the same shape the Flutter client writes,
  // so both clients read and write the same place.
  //
  // Logs written before that convention kept their answers in an
  // `inspection_logs/{id}/inspection_results` sub-collection instead. Those were
  // copied up into the parent `results` field and the sub-collections are now
  // legacy; nothing writes to them, but they are still read — fetchInspectionDetails
  // falls back to the sub-collection when this array is empty.
  //
  // Two screens render these answers, both through InspectionChecklistView: the
  // Inspections detail dialog and the establishment history modal. So the shape
  // of an entry is load-bearing — `sub_category`, `item_name`, `answer`, `weight`
  // and `note` are all read, and it stays `any[]` only because the two clients
  // have written it loosely over time.
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

// One masterlist upload, written as it runs so it doubles as the audit
// record: which file, who ran it, and what the importer decided in bulk.
export interface UploadBatch {
  id: string;
  file_name: string;
  group: "food" | "non_food";
  uploaded_by: string; // auth uid
  status: "running" | "done" | "failed";
  started_at: string;
  finished_at: string | null;
  error: string | null;
  counters: {
    updated: number;
    renewals: number;
    created: number;
    review: number;
    duplicates: number;
    skipped: number;
    /** Rows imported as NEW establishments even though the name already
     *  existed, because the address differs. Not a problem — that is the
     *  rule — but the report names them so an admin can spot a mistyped
     *  address masquerading as a second branch. */
    same_name_new_address: number;
    /** Rows imported as their own establishment because the same business at
     *  the same address already got a record under a DIFFERENT permit number
     *  in this upload: one permit per permitted activity (a bakery permit and
     *  a cafe permit at one supermarket). Each is inspected against its own
     *  checklist, so each needs its own record. */
    multi_permit_same_place: number;
  };
  /** Establishments present in the database but absent from this file —
   *  candidates for delisting, decided by a human, never automatically. */
  missing_establishment_ids: string[];
}

// A near-match the importer refused to merge on its own. An admin resolves
// it from the Review Queue panel on the import page: merge into a candidate,
// create a new record, or dismiss.
export interface ReviewQueueItem {
  id: string;
  batch_id: string;
  group: "food" | "non_food";
  status: "pending" | "merged" | "created" | "dismissed";
  created_at: string;
  decided_at: string | null;
  sheet_name: string;
  row_number: number;
  // Legacy only: items written before categorisation was removed from the
  // import flow carry the sheet-category id. Nothing reads it any more.
  category_id?: string;
  row: Record<string, unknown>; // the parsed MasterlistRow, as stored
  candidates: {
    establishment_id: string;
    business_name: string;
    // Why this record is being offered — "same-name-same-address",
    // "same-name-unknown-address", "already-claimed" or "same-permit". The
    // panel words each one as a different question; see ReviewReason in
    // lib/import/matchRows.ts. There is no similarity score: nothing in the
    // importer matches on name resemblance any more.
    reason: string;
    // The candidate's address as stored. The admin's decision is almost
    // always "is this the same place?", so the panel shows this next to the
    // row's own address.
    address_text: string | null;
  }[];
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
