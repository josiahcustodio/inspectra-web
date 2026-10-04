// [REF: MASTERLIST_IMPORT_WRITES]
//
// Executes the decisions made by the match cascade, in chunked write batches.
//
// THE RULE THIS FILE IS BUILT AROUND: the importer has no write path to
// inspection data. Nothing here imports from, reads, or writes
// inspection_logs — the live DATE INSPECTED and REMARKS the dashboard shows
// are computed from inspection_logs at render time, so a re-upload can never
// erase inspection progress no matter what is in the spreadsheet. The
// masterlist's own remarks columns land in `import_*` fields, which the UI
// treats as historical reference only.
//
// Second rule, learned from a past bug in this app: establishment writes are
// ALWAYS setDoc(..., { merge: true }) with only the fields the spreadsheet
// actually filled in. A blank Excel cell must never erase a value we already
// have, and a merge write can never blank out fields the spreadsheet doesn't
// know about (qr_code_id, coordinates, sanitary_permit_no).

import { collection, doc, getDocs, setDoc, writeBatch } from "firebase/firestore";
import { firebaseDb } from "@/lib/firebase";
import { COLLECTIONS, PERMITS_SUBCOLLECTION } from "@/lib/firestore";
import type { Establishment, ReviewQueueItem, UploadBatch } from "@/lib/models";
import type { MasterlistRow } from "./parseWorkbook";
import type { ImportGroup, MatchDecision } from "./matchRows";
import { normText } from "./normalize";

export type ImportCounters = UploadBatch["counters"];

export interface ImportResult {
  batchId: string;
  counters: ImportCounters;
  /** In-scope establishments this file did not mention — delisting candidates. */
  missing: Establishment[];
}

// Decisions per Firestore batch. Each decision writes at most 3 documents
// (establishment + permit + batch progress), and a batch holds 500 ops, so
// 150 leaves comfortable headroom.
const DECISIONS_PER_CHUNK = 150;

// NOTE: there is deliberately NO category handling anywhere in this file.
// Categories are assigned at INSPECTION time, from the checklist the
// inspector scores against — the masterlist's own classifier is its
// "Line/Kind of Business" column, which imports as a plain field.

export async function executeImport(opts: {
  decisions: MatchDecision[];
  group: ImportGroup;
  fileName: string;
  uploadedBy: string;
  /** Everything fetched for matching — used for the missing-from-file report. */
  existing: Establishment[];
  /** Rows the parser set aside, counted into the batch record. */
  skippedRows: number;
  onProgress?: (done: number, total: number) => void;
}): Promise<ImportResult> {
  const { decisions, group } = opts;
  const batchId = crypto.randomUUID();
  const now = () => new Date().toISOString();

  const counters: ImportCounters = {
    updated: 0,
    renewals: 0,
    created: 0,
    review: 0,
    duplicates: 0,
    skipped: opts.skippedRows,
  };

  // Review items use DETERMINISTIC ids (a hash of what identifies the row),
  // so re-running a file converges on the same documents. Items that already
  // exist are not rewritten at all: a pending one needs no second copy, and
  // one an admin already resolved must not be resurrected to "pending".
  const existingReviewIds = new Set(
    (await getDocs(collection(firebaseDb, COLLECTIONS.reviewQueue))).docs.map((d) => d.id),
  );

  const batchRef = doc(firebaseDb, COLLECTIONS.uploadBatches, batchId);
  await setDoc(batchRef, {
    id: batchId,
    file_name: opts.fileName,
    group,
    uploaded_by: opts.uploadedBy,
    status: "running",
    started_at: now(),
    finished_at: null,
    error: null,
    counters,
    missing_establishment_ids: [],
  });

  // Ids this run touched (matched or created) — the complement, within the
  // file's scope, is the missing-from-file list.
  const seenEstablishmentIds = new Set<string>();

  try {
    for (let start = 0; start < decisions.length; start += DECISIONS_PER_CHUNK) {
      const chunk = decisions.slice(start, start + DECISIONS_PER_CHUNK);
      const batch = writeBatch(firebaseDb);

      for (const decision of chunk) {
        switch (decision.kind) {
          case "update-permit":
          case "renewal": {
            const est = decision.establishment;
            seenEstablishmentIds.add(est.id);
            batch.set(
              doc(firebaseDb, COLLECTIONS.establishments, est.id),
              establishmentFields(decision.row, group, batchId),
              { merge: true },
            );
            writePermitDoc(batch, est.id, decision.row, batchId);
            if (decision.kind === "update-permit") counters.updated += 1;
            else counters.renewals += 1;
            break;
          }

          case "create": {
            const newId = decision.newId ?? crypto.randomUUID();
            seenEstablishmentIds.add(newId);
            batch.set(
              doc(firebaseDb, COLLECTIONS.establishments, newId),
              {
                // id stored as a field too — the shape the Flutter client reads.
                id: newId,
                business_name: decision.row.business_name ?? "",
                created_at: now(),
                source_batch_id: batchId,
                ...establishmentFields(decision.row, group, batchId),
              },
              { merge: true },
            );
            writePermitDoc(batch, newId, decision.row, batchId);
            counters.created += 1;
            break;
          }

          case "review": {
            // The candidates ARE mentioned by this file — without this, a
            // business whose row merely landed in review would show up in
            // the missing-from-file report as a delisting candidate while
            // its own row sits in the queue.
            for (const c of decision.candidates) {
              seenEstablishmentIds.add(c.establishment.id);
            }
            counters.review += 1;

            // Already queued (a re-run of this file) or already resolved (the
            // admin decided this row on an earlier run of this file). Either
            // way the row is not written again; `counters.review` still counts
            // it, since the report is per-run and the row did reach review.
            const reviewId = stableReviewId(group, opts.fileName, decision.row);
            if (existingReviewIds.has(reviewId)) break;
            existingReviewIds.add(reviewId);
            batch.set(doc(firebaseDb, COLLECTIONS.reviewQueue, reviewId), {
              id: reviewId,
              batch_id: batchId,
              group,
              status: "pending",
              created_at: now(),
              decided_at: null,
              sheet_name: decision.row.sheetName,
              row_number: decision.row.rowNumber,
              row: rowForStorage(decision.row),
              candidates: decision.candidates.map((c) => ({
                establishment_id: c.establishment.id,
                business_name: c.establishment.business_name,
                similarity: Math.round(c.similarity * 100) / 100,
                reason: c.reason,
              })),
            });
            break;
          }

          case "duplicate-in-file": {
            // Nothing to write: the first occurrence already imported, and the
            // report tells the admin which Excel rows collided.
            counters.duplicates += 1;
            break;
          }
        }
      }

      // Progress rides in the same batch, so the audit record stays honest
      // even if the tab dies mid-import: counters reflect committed work only.
      batch.set(batchRef, { counters: { ...counters } }, { merge: true });
      await batch.commit();
      opts.onProgress?.(Math.min(start + chunk.length, decisions.length), decisions.length);
    }
  } catch (err) {
    // A failed commit means that chunk did not land (batches are atomic).
    // Record the failure and rethrow — re-running the same file is safe,
    // because every write above is a merge keyed on stable ids.
    await setDoc(
      batchRef,
      { status: "failed", finished_at: now(), error: err instanceof Error ? err.message : String(err) },
      { merge: true },
    );
    throw err;
  }

  // Missing-from-file: previously imported into this group, still active,
  // but never mentioned by this upload. Hand-created records (no `group`)
  // are deliberately out of scope — flagging them as "missing" on every
  // upload would be noise about records the masterlist never owned.
  // Flagged for a human — never auto-delisted.
  const missing = opts.existing.filter(
    (est) =>
      !seenEstablishmentIds.has(est.id) &&
      est.status !== "delisted" &&
      est.group === group,
  );

  await setDoc(
    batchRef,
    {
      status: "done",
      finished_at: now(),
      counters,
      // Capped: a pathological id list must never push the batch document
      // toward Firestore's 1 MiB limit. The UI recomputes the full list live.
      missing_establishment_ids: missing.slice(0, 2000).map((e) => e.id),
    },
    { merge: true },
  );

  return { batchId, counters, missing };
}

// ─── Field builders ─────────────────────────────────────────────────────────

/** Fields a masterlist row may set on an establishment. Only values the
 *  spreadsheet actually has are included — newest-file-wins for what it says,
 *  silence for what it leaves blank. Note what is ABSENT: category fields.
 *  The import never touches them; an establishment's category is set by its
 *  inspections (the checklist they were scored against). */
function establishmentFields(
  row: MasterlistRow,
  group: ImportGroup,
  batchId: string,
): Record<string, unknown> {
  const fields: Record<string, unknown> = {
    group,
    // Which sheet this business last appeared on — the matcher scopes its
    // duplicate-detection by it on the next upload.
    masterlist_sheet: row.sheetName,
    // A business present in the latest masterlist is active by definition —
    // this also revives one that was delisted after dropping out of an
    // earlier file.
    status: "active",
    last_seen_batch_id: batchId,
    updated_at: new Date().toISOString(),
  };

  if (row.business_name) fields.business_name = row.business_name;
  if (row.owner_name) fields.owner_name = row.owner_name;
  if (row.address) fields.address = row.address;
  if (row.barangay) fields.barangay = row.barangay;
  if (row.tel_no) fields.tel_no = row.tel_no;
  if (row.tin) fields.tin = row.tin;
  if (row.business_permit_no) fields.business_permit_no = row.business_permit_no;
  if (row.applic_type) fields.applic_type = row.applic_type;
  if (row.permit_date_issued) fields.permit_date_issued = row.permit_date_issued;
  if (row.line_of_business) fields.line_of_business = row.line_of_business;
  if (row.floor_area_sqm !== null) fields.floor_area_sqm = row.floor_area_sqm;
  if (row.personnel_count !== null) fields.personnel_count = row.personnel_count;
  if (row.import_remarks) fields.import_remarks = row.import_remarks;
  if (row.import_date_inspected) fields.import_date_inspected = row.import_date_inspected;
  if (row.import_sssr) fields.import_sssr = row.import_sssr;

  return fields;
}

/** One document per permit-year under the establishment. Keyed by the permit
 *  number itself, so re-importing the same file converges on the same
 *  documents instead of duplicating them. Rows with no valid permit number —
 *  a blank cell, a placeholder like "N/A" or "pending", or a format
 *  PERMIT_NO_PATTERN does not recognise — update the establishment but leave
 *  no permit record, and nothing else persists their `raw` cells. */
function writePermitDoc(
  batch: ReturnType<typeof writeBatch>,
  establishmentId: string,
  row: MasterlistRow,
  batchId: string,
): void {
  if (!row.business_permit_no) return;
  // '/' is the one character a Firestore doc id cannot contain.
  const permitDocId = row.business_permit_no.replace(/\//g, "_");

  batch.set(
    doc(firebaseDb, COLLECTIONS.establishments, establishmentId, PERMITS_SUBCOLLECTION, permitDocId),
    {
      ...rowForStorage(row),
      permit_no: row.business_permit_no,
      source_batch_id: batchId,
      imported_at: new Date().toISOString(),
    },
    { merge: true },
  );
}

/** A MasterlistRow as stored in Firestore: every parsed field plus the
 *  original cells — this is the per-record audit trail. */
function rowForStorage(row: MasterlistRow): Record<string, unknown> {
  return { ...row };
}

/** A review item's document id, derived from what identifies the row, so
 *  re-importing the same file lands on the same document instead of queueing
 *  a duplicate.
 *
 *  The identity is the permit number when the row has a valid one; otherwise
 *  the row's recorded fields — name, barangay, owner, address, date issued —
 *  never the trade name alone: placeholder permits parse as null, and many
 *  unrelated rows share a name like "Sari-Sari Store", so a name-only key
 *  made the second such row silently vanish (counted, never queued). The
 *  file name is part of the key too, so a resolved item from last year's file
 *  cannot swallow this year's same-looking row — the yearly masterlists carry
 *  the year in their name. Two 32-bit hashes (djb2 and sdbm) over the key,
 *  hex-encoded: a single 32-bit hash collides often enough at a few thousand
 *  items that a lost row was a matter of time. */
function stableReviewId(group: string, fileName: string, row: MasterlistRow): string {
  const identity =
    row.business_permit_no ??
    [
      normText(row.business_name),
      normText(row.barangay),
      normText(row.owner_name),
      normText(row.address),
      row.permit_date_issued ?? "",
    ].join("|");
  const key = `${group}|${normText(fileName)}|${row.sheetName}|${identity}`;
  let djb2 = 5381;
  let sdbm = 0;
  for (let i = 0; i < key.length; i++) {
    const c = key.charCodeAt(i);
    djb2 = ((djb2 << 5) + djb2 + c) >>> 0;
    sdbm = (c + (sdbm << 6) + (sdbm << 16) - sdbm) >>> 0;
  }
  return `rq-${djb2.toString(16).padStart(8, "0")}${sdbm.toString(16).padStart(8, "0")}`;
}

// ─── Review-queue resolution ────────────────────────────────────────────────

/** Applies an admin's decision on a review item — the second half of the
 *  "never auto-merge" contract: the importer parks the row, and THIS is
 *  where a human lands it.
 *
 *  merge  -> the row was the candidate business after all: apply it exactly
 *            as a renewal would have been applied (same field rules, same
 *            permit doc).
 *  create -> genuinely a different business: new establishment + permit.
 *  dismiss-> bad row, import nothing.
 *
 *  All three stamp the item's status, so a resolved item never reappears —
 *  the importer skips review ids that already exist. */
export async function applyReviewDecision(opts: {
  item: ReviewQueueItem;
  action: "merge" | "create" | "dismiss";
  /** Required for "merge": which candidate to merge into. */
  targetEstablishmentId?: string;
}): Promise<void> {
  const { item, action } = opts;
  const row = item.row as unknown as MasterlistRow;
  const batch = writeBatch(firebaseDb);
  const itemRef = doc(firebaseDb, COLLECTIONS.reviewQueue, item.id);

  if (action === "merge") {
    if (!opts.targetEstablishmentId) throw new Error("Merge needs a target establishment.");
    batch.set(
      doc(firebaseDb, COLLECTIONS.establishments, opts.targetEstablishmentId),
      establishmentFields(row, item.group, item.batch_id),
      { merge: true },
    );
    writePermitDoc(batch, opts.targetEstablishmentId, row, item.batch_id);
  } else if (action === "create") {
    const newId = crypto.randomUUID();
    batch.set(
      doc(firebaseDb, COLLECTIONS.establishments, newId),
      {
        id: newId,
        business_name: row.business_name ?? "",
        created_at: new Date().toISOString(),
        source_batch_id: item.batch_id,
        ...establishmentFields(row, item.group, item.batch_id),
      },
      { merge: true },
    );
    writePermitDoc(batch, newId, row, item.batch_id);
  }

  batch.set(
    itemRef,
    {
      status: action === "merge" ? "merged" : action === "create" ? "created" : "dismissed",
      decided_at: new Date().toISOString(),
      ...(action === "merge" ? { resolved_establishment_id: opts.targetEstablishmentId } : {}),
    },
    { merge: true },
  );
  await batch.commit();
}
