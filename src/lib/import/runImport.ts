// [REF: MASTERLIST_IMPORT_WRITES]
//
// Executes the decisions made by the match cascade, in chunked upsert groups.
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
// ALWAYS upserts carrying only the fields the spreadsheet actually filled in
// (PostgREST's ON CONFLICT UPDATE touches only the payload's columns — the
// same contract setDoc(merge:true) gave us). A blank Excel cell must never
// erase a value we already have, and a partial upsert can never blank out
// fields the spreadsheet doesn't know about (qr_code_id, coordinates,
// sanitary_permit_no).
//
// Atomicity note for the Supabase era: Firestore batches were atomic per
// chunk; the sequential upserts below are not. That is acceptable by this
// file's own design — every write converges on a stable id, so re-running
// the same file confirms finished rows instead of duplicating them, and the
// batch record's counters are written AFTER the chunk's rows, so they only
// ever under-count committed work, never invent it.

import { supabase, fetchAllRows } from "@/lib/supabase";
import { COLLECTIONS, PERMITS_TABLE } from "@/lib/dataAccess";
import type { Establishment, ReviewQueueItem, UploadBatch } from "@/lib/models";
import type { MasterlistRow } from "./parseWorkbook";
import type { ImportGroup, MatchDecision } from "./matchRows";
import { normText } from "./normalize";
import { barangayWithoutCity, canonicalBarangay } from "@/lib/barangayGeo";

export type ImportCounters = UploadBatch["counters"];

export interface ImportResult {
  batchId: string;
  counters: ImportCounters;
  /** In-scope establishments this file did not mention — delisting candidates. */
  missing: Establishment[];
}

// Decisions per round of upserts. Each decision writes at most 3 rows
// (establishment + permit + batch progress); 150 keeps each request body
// comfortably small.
const DECISIONS_PER_CHUNK = 150;

// NOTE: there is deliberately NO category handling anywhere in this file.
// Categories are assigned at INSPECTION time, from the checklist the
// inspector scores against — the masterlist's own classifier is its
// "Line/Kind of Business" column, which imports as a plain field.

// Every thrown write error carries the PostgREST error code (e.g. 42501 =
// insufficient_privilege) ahead of the message, so callers can branch on the
// stable code instead of matching prose that may change between releases.
function writeError(context: string, error: { code?: string | null; message: string }): Error {
  return new Error(
    error.code ? `${context}: ${error.code}: ${error.message}` : `${context}: ${error.message}`,
  );
}

// PostgREST requires every object in one bulk insert to carry the SAME keys,
// and establishmentFields() deliberately includes only what the spreadsheet
// filled in — so payload shapes vary row to row. Group by key signature and
// issue one upsert per group; in practice a sheet produces only a handful of
// signatures, so a 150-decision chunk still lands in a few requests.
async function upsertGrouped(
  table: string,
  rows: Record<string, unknown>[],
  onConflict?: string,
): Promise<void> {
  const groups = new Map<string, Record<string, unknown>[]>();
  for (const row of rows) {
    const signature = Object.keys(row).sort().join(",");
    const group = groups.get(signature);
    if (group) group.push(row);
    else groups.set(signature, [row]);
  }
  for (const group of groups.values()) {
    const query = supabase.from(table);
    const { error } = onConflict
      ? await query.upsert(group, { onConflict })
      : await query.upsert(group);
    if (error) throw writeError(table, error);
  }
}

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
    same_name_new_address: 0,
    multi_permit_same_place: 0,
  };

  // Review items use DETERMINISTIC ids (a hash of what identifies the row),
  // so re-running a file converges on the same rows. Items that already
  // exist are not rewritten at all: a pending one needs no second copy, and
  // one an admin already resolved must not be resurrected to "pending".
  const existingReviewIds = new Set<string>(
    (await fetchAllRows(COLLECTIONS.reviewQueue)).map((r) => r.id as string),
  );

  const { error: batchCreateError } = await supabase
    .from(COLLECTIONS.uploadBatches)
    .insert({
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
  if (batchCreateError) throw writeError(COLLECTIONS.uploadBatches, batchCreateError);

  // Ids this run touched (matched or created) — the complement, within the
  // file's scope, is the missing-from-file list.
  const seenEstablishmentIds = new Set<string>();

  try {
    for (let start = 0; start < decisions.length; start += DECISIONS_PER_CHUNK) {
      const chunk = decisions.slice(start, start + DECISIONS_PER_CHUNK);
      const establishmentRows: Record<string, unknown>[] = [];
      const permitRows: Record<string, unknown>[] = [];
      const reviewRows: Record<string, unknown>[] = [];

      for (const decision of chunk) {
        switch (decision.kind) {
          case "update-permit":
          case "renewal": {
            const est = decision.establishment;
            seenEstablishmentIds.add(est.id);
            establishmentRows.push({
              id: est.id,
              ...establishmentFields(decision.row, group, batchId),
            });
            const permit = permitRow(est.id, decision.row, batchId);
            if (permit) permitRows.push(permit);
            if (decision.kind === "update-permit") counters.updated += 1;
            else counters.renewals += 1;
            break;
          }

          case "create": {
            const newId = decision.newId ?? crypto.randomUUID();
            seenEstablishmentIds.add(newId);
            establishmentRows.push(newEstablishmentRow(newId, decision.row, group, batchId));
            const permit = permitRow(newId, decision.row, batchId);
            if (permit) permitRows.push(permit);
            counters.created += 1;
            // A new record whose name already exists at another address. The
            // rule says that is a different business, so nothing was blocked —
            // this only feeds the report.
            if (decision.sameNameElsewhere.length > 0) counters.same_name_new_address += 1;
            if (decision.samePlaceDifferentPermit.length > 0) counters.multi_permit_same_place += 1;
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
            reviewRows.push({
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
                reason: c.reason,
                address_text: c.addressText ?? null,
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

      await upsertGrouped(COLLECTIONS.establishments, establishmentRows);
      await upsertGrouped(PERMITS_TABLE, permitRows, "establishment_id,permit_no");
      await upsertGrouped(COLLECTIONS.reviewQueue, reviewRows);

      // Progress lands after the chunk's rows, so the audit record stays
      // honest even if the tab dies mid-import: counters reflect committed
      // work only (at worst one chunk behind, never ahead).
      const { error: progressError } = await supabase
        .from(COLLECTIONS.uploadBatches)
        .update({ counters: { ...counters } })
        .eq("id", batchId);
      if (progressError) throw writeError(COLLECTIONS.uploadBatches, progressError);
      opts.onProgress?.(Math.min(start + chunk.length, decisions.length), decisions.length);
    }
  } catch (err) {
    // A failed request means that group of rows did not land. Record the
    // failure and rethrow — re-running the same file is safe, because every
    // write above is an upsert keyed on stable ids.
    await supabase
      .from(COLLECTIONS.uploadBatches)
      .update({
        status: "failed",
        finished_at: now(),
        error: err instanceof Error ? err.message : String(err),
      })
      .eq("id", batchId);
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

  const { error: doneError } = await supabase
    .from(COLLECTIONS.uploadBatches)
    .update({
      status: "done",
      finished_at: now(),
      counters,
      // Capped: a pathological id list must never balloon the batch row.
      // The UI recomputes the full list live.
      missing_establishment_ids: missing.slice(0, 2000).map((e) => e.id),
    })
    .eq("id", batchId);
  if (doneError) throw writeError(COLLECTIONS.uploadBatches, doneError);

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

  // The barangay is stored as the OFFICIAL boundary name, not as the
  // spreadsheet wrote it. Every row in the file repeats ", Batangas City", and
  // the same place arrives spelled several ways across sheets ("Poblacion
  // 022" / "Barangay 22", "Sta. Rita Carsada" / "Santa Rita Karsada") — so
  // storing the raw text leaves the barangay filter showing one place as four
  // entries and the GIS map unable to plot a quarter of the list. Resolving
  // once, here, means every reader gets a value that already matches a
  // boundary. A value that resolves to no boundary at all keeps its own text
  // minus the city tail, so it stays recognisable in the unmapped report; the
  // untouched original is always in the permit record's `raw`.
  if (row.barangay) {
    fields.barangay = canonicalBarangay(row.barangay) ?? barangayWithoutCity(row.barangay);
  }
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

/** One row per permit-year in establishment_permits, keyed on
 *  (establishment_id, permit_no) so re-importing the same file converges on
 *  the same rows instead of duplicating them. The parsed MasterlistRow plus
 *  its raw original cells travel in the `data` jsonb column — the per-record
 *  audit trail. (The Firestore-era '/'→'_' doc-id munging is gone: a permit
 *  number is stored exactly as written.)
 *
 *  Returns null for rows with no valid permit number — a blank cell, a
 *  placeholder like "N/A" or "pending", or a format PERMIT_NO_PATTERN does
 *  not recognise. Those update the establishment but leave no permit record,
 *  and nothing else persists their `raw` cells.
 *
 *  CONTRACT: the import batch path and the review-decision path both store
 *  permits through this one builder, so the two can never drift on shape. */
function permitRow(
  establishmentId: string,
  row: MasterlistRow,
  batchId: string,
): Record<string, unknown> | null {
  if (!row.business_permit_no) return null;
  return {
    establishment_id: establishmentId,
    permit_no: row.business_permit_no,
    data: rowForStorage(row),
    source_batch_id: batchId,
    imported_at: new Date().toISOString(),
  };
}

/** The full payload for a brand-new establishment: identity + birth fields
 *  that only exist at creation (created_at, source_batch_id) on top of the
 *  spreadsheet-driven fields. Shared by the import "create" decision and the
 *  review panel's "create" action — same reason as permitRow above. */
function newEstablishmentRow(
  id: string,
  row: MasterlistRow,
  group: ImportGroup,
  batchId: string,
): Record<string, unknown> {
  return {
    id,
    business_name: row.business_name ?? "",
    created_at: new Date().toISOString(),
    source_batch_id: batchId,
    ...establishmentFields(row, group, batchId),
  };
}

/** A MasterlistRow as stored: every parsed field plus the original cells —
 *  this is the per-record audit trail. */
function rowForStorage(row: MasterlistRow): Record<string, unknown> {
  return { ...row };
}

/** A review item's row id, derived from what identifies the row, so
 *  re-importing the same file lands on the same row instead of queueing
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
 *            permit row).
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

  if (action === "merge") {
    if (!opts.targetEstablishmentId) throw new Error("Merge needs a target establishment.");
    const { error } = await supabase.from(COLLECTIONS.establishments).upsert({
      id: opts.targetEstablishmentId,
      ...establishmentFields(row, item.group, item.batch_id),
    });
    if (error) throw writeError(COLLECTIONS.establishments, error);
    await writePermit(opts.targetEstablishmentId, row, item.batch_id);
  } else if (action === "create") {
    const newId = crypto.randomUUID();
    const { error } = await supabase
      .from(COLLECTIONS.establishments)
      .upsert(newEstablishmentRow(newId, row, item.group, item.batch_id));
    if (error) throw writeError(COLLECTIONS.establishments, error);
    await writePermit(newId, row, item.batch_id);
  }

  const { error: stampError } = await supabase
    .from(COLLECTIONS.reviewQueue)
    .update({
      status: action === "merge" ? "merged" : action === "create" ? "created" : "dismissed",
      decided_at: new Date().toISOString(),
      ...(action === "merge" ? { resolved_establishment_id: opts.targetEstablishmentId } : {}),
    })
    .eq("id", item.id);
  if (stampError) throw writeError(COLLECTIONS.reviewQueue, stampError);
}

/** The review path's single-row write of the same permitRow() payload the
 *  batch path collects into arrays. */
async function writePermit(
  establishmentId: string,
  row: MasterlistRow,
  batchId: string,
): Promise<void> {
  const permit = permitRow(establishmentId, row, batchId);
  if (!permit) return;
  const { error } = await supabase
    .from(PERMITS_TABLE)
    .upsert(permit, { onConflict: "establishment_id,permit_no" });
  if (error) throw writeError(PERMITS_TABLE, error);
}
