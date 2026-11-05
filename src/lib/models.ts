// [REF: DOMAIN_MODELS]
//
// The shapes the UI works with. These mirror the Postgres rows one-for-one
// (with the inspector document's snake_case field names normalised in
// firestore.ts) and carry no sync bookkeeping: the app is cloud-only, so a
// record either exists in the database or it does not exist at all.

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
  // Extra inputs the mobile form asks for on this item besides Pass/Fail/N/A
  // (the blanks and Y/N boxes of forms like Livestock Farm). Answers land in
  // `InspectionLog.results[].values` keyed by label. `type` is text | number |
  // date | yesno | choice | multi; the last two list their `options`.
  fields?: { label: string; type?: string; options?: string[] }[];
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
  // Optional GPS coordinates. No screen writes them yet; today they exist only
  // on rows seeded by migration/seed_osm_fastfood.py. Read by the GIS pin
  // layer ([REF: GIS_PINS] in pages/GISMap.tsx) and the mobile field map.
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
  // Where an emailed copy of a Sanitary Order goes. Captured on the mobile
  // form at inspection time — the only moment anyone is standing in front of
  // the person who knows it — and editable here. Absent on every record
  // created before the order existed.
  point_person_name?: string | null;
  point_person_email?: string | null;
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
  // The establishment's name, denormalised onto the log by the mobile client
  // at write time so any reader can display it without resolving the id. The
  // column has always existed; this declaration had not, so TypeScript denied
  // a field the mapper's spread was already delivering. Optional because logs
  // predating the convention lack it, and `establishment_id` can dangle —
  // history outlives deletes, which is exactly when this is the only name left.
  establishment_name?: string | null;
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

  // ── Sanitary Order (CHO-ESD-FR-04) ─────────────────────────────────────
  // Present only on an inspection that found at least one defect. Written by
  // the Flutter client at inspection time — the web admin reads these and
  // never writes them, the same invariant as the rest of this record.
  //
  // `so_issued_at` is the marker that an order exists, NOT `so_no`: the number
  // is typed off CHO's pre-numbered booklet and is allowed to stay null until
  // their numbering pattern is known. Test `so_issued_at != null` to ask
  // "did this inspection issue an order?"; a null `so_no` on an issued order
  // is a blank line on the form, not a missing record.
  so_no?: string | null;
  so_issued_at?: string | null;
  time_given?: string | null;
  deadline?: string | null; // "YYYY-MM-DD" — a calendar day, not an instant
  // The form's "Received by" line: the owner or point person acknowledging
  // service on site. This is what makes the notice served — an emailed copy
  // is a convenience afterwards. Stored at
  // signatures/{establishment_id}/{log_id}_received.png, a DIFFERENT object
  // from `signature_url` above ("Delivered by"); sharing one would overwrite
  // the inspector's sign-off and break its sha256 pairing.
  received_by_name?: string | null;
  received_signature_url?: string | null;
  received_signature_sha256?: string | null;
  // Stamped by the delivery function, server-side. Null means "not emailed",
  // which is also the state of every order issued before delivery existed.
  email_sent_at?: string | null;
  // Per-item checklist answers, read straight off the `results` jsonb array on
  // the `inspection_logs` row — the same shape the Flutter client writes, so
  // both clients read and write the same place. The Firestore-era
  // `inspection_results` sub-collection is gone, folded into this field by the
  // migration; there is no fallback read (see
  // [REF: INSPECTION_DETAILS_FETCH_WEB] in lib/firestore.ts).
  //
  // Two screens render these answers, both through InspectionChecklistView: the
  // Inspections detail dialog and the establishment history modal. So the shape
  // of an entry is load-bearing — `sub_category`, `item_name`, `answer`, `weight`
  // and `note` are all read, and it stays `any[]` only because the two clients
  // have written it loosely over time.
  //
  // Entries also carry `correction` — the right-hand column of the Sanitary
  // Order's table, what the establishment is ordered to do about the defect.
  // The order's defect list is derived from here by filtering
  // `answer === 'Fail'`, and NEVER by "has a note": a note can outlive the
  // Fail that justified it, and printing one as a violation would cite
  // something the inspector withdrew.
  results?: any[];
}

// A registered account (one row in `profiles`), written server-side by the
// handle_new_user() trigger the moment the auth user is born — no client
// writes it. Only admins may list this table — the officer-facing UI treats a
// permission error on it as "source unavailable", not as a failure.
export interface Profile {
  id: string; // auth uid
  /** public.app_role: 'admin' | 'officer' | 'pending' | 'owner'. Only the
   *  first two are staff; see AppRole in lib/useAuth.tsx. Kept as `string`
   *  because a later migration can add a value this build predates — readers
   *  must treat an unrecognised role as non-staff, never default it. */
  role: string;
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
