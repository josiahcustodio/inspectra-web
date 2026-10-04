// [REF: MASTERLIST_MATCH_CASCADE]
//
// Decides what each parsed Excel row MEANS: the same permit we already have,
// a renewal for a business we know, a brand-new business, or a near-miss
// that a human has to judge.
//
// The cascade runs in strict order of confidence, and the order matters
// because a permit number identifies a permit-YEAR, not a business — on
// renewal the city issues a fresh number, so "permit number not found" is
// the normal yearly case, not an anomaly:
//
//   1. Permit number already in the database  -> same permit, refresh fields
//   2. Same TIN AND same trade name           -> same business, new permit (renewal).
//      TIN alone is NOT enough: a TIN identifies an owner, and one sole
//      proprietor can hold several businesses. Same TIN with a different
//      name goes to review instead of silently merging two businesses.
//   3. Same group + barangay + trade name     -> same business, new permit (renewal)
//   4. Similar trade name in the same place   -> REVIEW. Never auto-merged:
//      a wrong merge silently attaches one business's inspection history to
//      another, which is the worst corruption this system could produce.
//   5. Nothing                                -> new establishment
//
// Identity is scoped by GROUP (food / non-food — i.e. which workbook), not
// by category: categories in this system are assigned at INSPECTION time,
// from the checklist the inspector scores against, so at import time most
// records have none. Establishments that predate the importer carry no
// group either — those are matched against every upload rather than being
// invisible to all of them.
//
// Barangay comparisons go through canonicalBarangay / barangayOfEstablishment
// from barangayGeo (the machinery the GIS map trusts), because alias
// spellings — "Bucal" vs "Bukal" — are live in stored records.
//
// Pure module: all matching happens against in-memory indexes built from one
// establishment fetch, so the cascade costs zero Firestore reads per row.
// Names are normalised and bigram-counted once at index time — a first-ever
// import compares each new row against everything indexed so far, and doing
// that work per-comparison instead of per-record froze the tab on big sheets.

import type { Establishment } from "@/lib/models";
import { barangayOfEstablishment, canonicalBarangay } from "@/lib/barangayGeo";
import type { MasterlistRow } from "./parseWorkbook";
import { bigramsOf, diceFromBigrams, normDigits, normText } from "./normalize";

export type ImportGroup = "food" | "non_food";

export interface ReviewCandidate {
  establishment: Establishment;
  similarity: number;
  /** Why this candidate is here — "same-tin" candidates can score low on
   *  name similarity and still be the same business. */
  reason: "similar-name" | "same-tin" | "same-name";
}

export type MatchDecision =
  | { kind: "update-permit"; row: MasterlistRow; establishment: Establishment }
  | { kind: "renewal"; row: MasterlistRow; establishment: Establishment; via: "tin" | "identity" }
  | { kind: "review"; row: MasterlistRow; candidates: ReviewCandidate[] }
  // `newId` is assigned by the caller, not here: the page pre-assigns the
  // document id so it can index the new record immediately — that is how a
  // business appearing twice in one upload matches itself on the second row
  // instead of being created twice.
  | { kind: "create"; row: MasterlistRow; newId?: string }
  | { kind: "duplicate-in-file"; row: MasterlistRow; firstRowNumber: number };

/** Below this Dice similarity, two names are just different businesses;
 *  at or above it (but not an exact normalised match), a human decides. */
const REVIEW_THRESHOLD = 0.6;
const MAX_REVIEW_CANDIDATES = 3;

/** One establishment with everything the cascade compares, precomputed. */
interface IndexedEstablishment {
  establishment: Establishment;
  nameNorm: string;
  nameBigrams: Map<string, number>;
  barangayKey: string;
}

/** Records with no `group` predate the importer; they live in this bucket
 *  and are candidates for EVERY upload. */
const NO_GROUP = "any";

export interface MatchIndexes {
  byPermitNo: Map<string, Establishment>;
  byTin: Map<string, IndexedEstablishment>;
  /** groupKey | barangayKey | nameNorm -> establishment */
  byIdentity: Map<string, Establishment>;
  /** Fuzzy/same-name candidate buckets. Keyed by group + SOURCE SHEET
   *  (`masterlist_sheet`, import bookkeeping — not a category): a whole
   *  food group is thousands of records and group-wide fuzzy matching
   *  drowns the review queue in cross-sheet lookalikes, while a renewal
   *  virtually always reappears on the same sheet it was on last year.
   *  A business that genuinely changed sheets is still caught by the exact
   *  identity key above, which stays group-wide. */
  byBucket: Map<string, IndexedEstablishment[]>;
}

/** The barangay as a comparison key: canonical boundary spelling when the
 *  value resolves to one ("Bucal" and "Bukal" both become "bukal"), the
 *  normalised raw text otherwise, "" when absent. */
function barangayKeyOf(raw: string | null | undefined): string {
  const canonical = canonicalBarangay(raw ?? null);
  return normText(canonical ?? raw ?? null);
}

function groupKeyOf(est: Establishment): string {
  return est.group === "food" || est.group === "non_food" ? est.group : NO_GROUP;
}

export function buildMatchIndexes(existing: Establishment[]): MatchIndexes {
  const indexes: MatchIndexes = {
    byPermitNo: new Map(),
    byTin: new Map(),
    byIdentity: new Map(),
    byBucket: new Map(),
  };
  for (const est of existing) {
    addToIndexes(indexes, est);
  }
  return indexes;
}

/** Also called for every establishment the current import creates, so a
 *  business that appears twice in one upload matches itself the second time
 *  instead of being created twice. */
export function addToIndexes(indexes: MatchIndexes, est: Establishment): void {
  const nameNorm = normText(est.business_name);
  const entry: IndexedEstablishment = {
    establishment: est,
    nameNorm,
    nameBigrams: bigramsOf(nameNorm),
    // barangayOfEstablishment, not est.barangay: legacy records keep their
    // barangay inside the structured address object, and indexing the bare
    // field would leave them unmatchable by their own renewals.
    barangayKey: barangayKeyOf(barangayOfEstablishment(est)),
  };

  const permitNo = (est.business_permit_no ?? "").trim().toUpperCase();
  if (permitNo) indexes.byPermitNo.set(permitNo, est);

  const tin = normDigits(est.tin ?? null);
  if (tin) indexes.byTin.set(tin, entry);

  if (nameNorm) {
    const groupKey = groupKeyOf(est);
    indexes.byIdentity.set(`${groupKey}|${entry.barangayKey}|${nameNorm}`, est);

    // Pre-importer records (no group) share one bucket, consulted by every
    // upload; imported records bucket by group + source sheet.
    const bucketKey =
      groupKey === NO_GROUP ? NO_GROUP : `${groupKey}|${normText(est.masterlist_sheet ?? null)}`;
    const bucket = indexes.byBucket.get(bucketKey);
    if (bucket) bucket.push(entry);
    else indexes.byBucket.set(bucketKey, [entry]);
  }
}

/** Everything an uploaded row may fuzzy-match against: its own group+sheet,
 *  records of its group that have no recorded sheet (imported before that
 *  field existed), and the pre-importer records that have no group at all. */
function candidatePool(indexes: MatchIndexes, group: ImportGroup, sheetName: string): IndexedEstablishment[] {
  return [
    ...(indexes.byBucket.get(`${group}|${normText(sheetName)}`) ?? []),
    ...(indexes.byBucket.get(`${group}|`) ?? []),
    ...(indexes.byBucket.get(NO_GROUP) ?? []),
  ];
}

export function decideRow(
  row: MasterlistRow,
  group: ImportGroup,
  indexes: MatchIndexes,
  permitNosSeenInFile: Map<string, number>,
): MatchDecision {
  // Step 0 — the same permit number twice in one upload is a spreadsheet
  // mistake (usually a copy-paste). Importing both would make the second
  // silently overwrite the first, so the second is set aside instead.
  if (row.business_permit_no) {
    const firstRowNumber = permitNosSeenInFile.get(row.business_permit_no);
    if (firstRowNumber !== undefined) {
      return { kind: "duplicate-in-file", row, firstRowNumber };
    }
    permitNosSeenInFile.set(row.business_permit_no, row.rowNumber);
  }

  const rowNameNorm = normText(row.business_name);
  const rowBarangayKey = barangayKeyOf(row.barangay);

  // Step 1 — permit number known: this exact permit was imported before and
  // management re-sent it (corrections, newly filled-in cells).
  if (row.business_permit_no) {
    const byPermit = indexes.byPermitNo.get(row.business_permit_no);
    if (byPermit) {
      return { kind: "update-permit", row, establishment: byPermit };
    }
  }

  // Step 2 — TIN: only the BPLO-layout sheets carry one. Same TIN plus the
  // same trade name is the strongest renewal signal there is; same TIN with
  // a DIFFERENT name is one owner's other business, and auto-merging it
  // would overwrite that record and fuse two inspection histories — so it
  // goes to a human instead.
  const tin = normDigits(row.tin);
  if (tin) {
    const byTin = indexes.byTin.get(tin);
    if (byTin) {
      if (rowNameNorm && rowNameNorm === byTin.nameNorm) {
        return { kind: "renewal", row, establishment: byTin.establishment, via: "tin" };
      }
      const rowBigrams = bigramsOf(rowNameNorm);
      return {
        kind: "review",
        row,
        candidates: [{
          establishment: byTin.establishment,
          similarity: diceFromBigrams(rowBigrams, rowNameNorm.length, byTin.nameBigrams, byTin.nameNorm.length),
          reason: "same-tin",
        }],
      };
    }
  }

  // Step 3 — exact identity: same group, same barangay, same trade name
  // (all through the canonicalised keys above). Checked against the row's
  // own group first, then against the pre-importer records that have none.
  if (rowNameNorm) {
    const byIdentity =
      indexes.byIdentity.get(`${group}|${rowBarangayKey}|${rowNameNorm}`) ??
      indexes.byIdentity.get(`${NO_GROUP}|${rowBarangayKey}|${rowNameNorm}`);
    if (byIdentity) {
      return { kind: "renewal", row, establishment: byIdentity, via: "identity" };
    }

    // The BPLO-layout sheets carry no barangay column, so their rows can
    // never hit the keyed lookup against a record that HAS one. An exact
    // name match within the group is still a confident renewal when it is
    // unambiguous; two same-named records (branches) are a human call.
    if (rowBarangayKey === "") {
      const sameName = candidatePool(indexes, group, row.sheetName).filter((e) => e.nameNorm === rowNameNorm);
      if (sameName.length === 1) {
        return { kind: "renewal", row, establishment: sameName[0].establishment, via: "identity" };
      }
      if (sameName.length > 1) {
        return {
          kind: "review",
          row,
          candidates: sameName.slice(0, MAX_REVIEW_CANDIDATES).map((e) => ({
            establishment: e.establishment,
            similarity: 1,
            reason: "same-name" as const,
          })),
        };
      }
    }
  }

  // Step 4 — fuzzy: close-but-not-equal names within the same group (and
  // the same barangay — unless either side doesn't name one, in which case
  // the doubt goes to review rather than to a duplicate). These go to a human.
  if (rowNameNorm) {
    const rowBigrams = bigramsOf(rowNameNorm);
    const candidates = candidatePool(indexes, group, row.sheetName)
      .filter((e) => rowBarangayKey === "" || e.barangayKey === "" || e.barangayKey === rowBarangayKey)
      .map((e) => ({
        establishment: e.establishment,
        similarity: diceFromBigrams(rowBigrams, rowNameNorm.length, e.nameBigrams, e.nameNorm.length),
        reason: "similar-name" as const,
      }))
      .filter((c) => c.similarity >= REVIEW_THRESHOLD)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, MAX_REVIEW_CANDIDATES);

    if (candidates.length > 0) {
      return { kind: "review", row, candidates };
    }
  }

  // Step 5 — genuinely new.
  return { kind: "create", row };
}
