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
//   2. Same TIN AND same trade name           -> same business, new permit (renewal),
//      when exactly ONE record fits and the row's barangay, if it names one,
//      agrees with the record's. TIN alone is NOT enough: a TIN identifies an
//      owner, and one sole proprietor can hold several businesses. A TIN
//      shared with records of OTHER names does not end the cascade — those
//      records ride along as "same-tin" candidates on whatever review the
//      later steps produce, and force a review if nothing else claims the row.
//   3. Same group + barangay + trade name     -> same business, new permit (renewal),
//      but only when exactly ONE record fits. Two same-named records in one
//      barangay are branches, and a human picks which one renewed. A row with
//      no barangay (the BPLO sheets) is compared by trade name against the
//      whole group and needs a second corroborating fact — the same owner, or
//      the same address — because a bare trade name is not unique across a
//      city.
//   4. Similar trade name in the same place   -> REVIEW. Never auto-merged:
//      a wrong merge silently attaches one business's inspection history to
//      another, which is the worst corruption this system could produce.
//   5. Nothing                                -> new establishment
//
// One claim per record per upload. A masterlist is one permit-year, so at most
// one row of a file may write to a record. Once a row has created, renewed or
// permit-updated a record, a later row that would land on the same record is
// either a duplicate row or a same-named branch — both a human call — and goes
// to review instead of silently overwriting the first row's fields. The caller
// records each claim as it takes the decision (see MatchIndexes).
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
// No Firestore here: all matching happens against in-memory indexes built
// from one establishment fetch, so the cascade costs zero reads per row. The
// caller owns the per-upload state the cascade needs — the permit numbers seen
// so far in the file, the records the upload is creating, and the records it
// has already claimed (see MatchDecision and MatchIndexes). Names are
// normalised and bigram-counted once at index time — a first-ever import
// compares each new row against everything indexed so far, and doing that
// work per-comparison instead of per-record froze the tab on big sheets.

import type { Establishment } from "@/lib/models";
import { barangayOfEstablishment, canonicalBarangay } from "@/lib/barangayGeo";
import type { MasterlistRow } from "./parseWorkbook";
import { bigramsOf, diceFromBigrams, normDigits, normText, permitKey } from "./normalize";

export type ImportGroup = "food" | "non_food";

export interface ReviewCandidate {
  establishment: Establishment;
  similarity: number;
  /** Why this candidate is here — "same-tin" candidates can score low on
   *  name similarity and still be the same business; "same-permit" ones
   *  carry the row's very permit number but were already written by an
   *  earlier row of this upload. */
  reason: "similar-name" | "same-tin" | "same-name" | "same-permit";
}

export type MatchDecision =
  | { kind: "update-permit"; row: MasterlistRow; establishment: Establishment }
  | { kind: "renewal"; row: MasterlistRow; establishment: Establishment; via: "tin" | "identity" }
  | { kind: "review"; row: MasterlistRow; candidates: ReviewCandidate[] }
  // `newId` is assigned by the caller, not here: the page pre-assigns the
  // document id, indexes the new record (addToIndexes) and adds the id to
  // `createdThisRun`, so a later row in the same upload with the same name and
  // barangay (or, without a barangay, the same name anywhere in the group) is
  // caught — and sent to review — instead of creating it twice or quietly
  // merging into a record that has no history yet. For "renewal" and
  // "update-permit" the caller adds `establishment.id` to `claimedThisRun`.
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
  /** permitKey(permit no) -> establishment. A permit number names one
   *  permit-year of one business, so a single record per key is right. */
  byPermitNo: Map<string, Establishment>;
  /** TIN digits -> every record carrying that TIN. One owner can hold several
   *  businesses, so this is a list — a single slot would keep only the last
   *  record indexed and hide the owner's other businesses from the cascade. */
  byTin: Map<string, IndexedEstablishment[]>;
  /** groupKey | barangayKey | nameNorm -> every record with that identity.
   *  Usually one; two or more means same-named branches in one barangay,
   *  which a single slot would silently collapse to whichever was indexed
   *  last. */
  byIdentity: Map<string, Establishment[]>;
  /** groupKey | nameNorm -> every record with that trade name in the group,
   *  whatever its barangay. Consulted only for rows that carry no barangay
   *  (the BPLO sheets), which can never hit the keyed identity above. It
   *  does not make the renewal — corroborates() still has to — it makes sure
   *  a same-named record on another sheet is seen at all instead of being
   *  created a second time. */
  byGroupName: Map<string, Establishment[]>;
  /** Fuzzy candidate buckets. Keyed by group + SOURCE SHEET
   *  (`masterlist_sheet`, import bookkeeping — not a category): a whole
   *  food group is thousands of records and group-wide fuzzy matching
   *  drowns the review queue in cross-sheet lookalikes, while a renewal
   *  virtually always reappears on the same sheet it was on last year.
   *  A business that genuinely changed sheets is still caught by an exact
   *  name: through byIdentity when its row names a barangay, through
   *  byGroupName when it does not. */
  byBucket: Map<string, IndexedEstablishment[]>;
  /** Ids of the records this upload is creating. The caller adds each one
   *  as it indexes the provisional record. They take part in matching like
   *  any other record — as review candidates — but are never renewal
   *  targets (see the header). */
  createdThisRun: Set<string>;
  /** Ids of existing records an earlier row of this upload has already
   *  renewed or permit-updated. The caller adds each one as it takes the
   *  decision. One claim per record per upload — see the header. */
  claimedThisRun: Set<string>;
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

function pushTo<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

export function buildMatchIndexes(existing: Establishment[]): MatchIndexes {
  const indexes: MatchIndexes = {
    byPermitNo: new Map(),
    byTin: new Map(),
    byIdentity: new Map(),
    byGroupName: new Map(),
    byBucket: new Map(),
    createdThisRun: new Set(),
    claimedThisRun: new Set(),
  };
  for (const est of existing) {
    addToIndexes(indexes, est);
  }
  return indexes;
}

/** Also called for every establishment the current import creates (with its
 *  id added to `createdThisRun` by the caller), so a later row with the same
 *  name and barangay — or the same name anywhere in the group, for a row with
 *  no barangay — is recognised instead of creating the business twice. */
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

  // Stored values are not validated the way parsed rows are — a legacy record
  // may hold "-" here — so the KEY is what has to be non-empty.
  const permitNo = est.business_permit_no == null ? "" : permitKey(String(est.business_permit_no));
  if (permitNo) indexes.byPermitNo.set(permitNo, est);

  const tin = normDigits(est.tin ?? null);
  if (tin) pushTo(indexes.byTin, tin, entry);

  if (nameNorm) {
    const groupKey = groupKeyOf(est);
    pushTo(indexes.byIdentity, `${groupKey}|${entry.barangayKey}|${nameNorm}`, est);
    pushTo(indexes.byGroupName, `${groupKey}|${nameNorm}`, est);

    // Pre-importer records (no group) share one bucket, consulted by every
    // upload; imported records bucket by group + source sheet.
    const bucketKey =
      groupKey === NO_GROUP ? NO_GROUP : `${groupKey}|${normText(est.masterlist_sheet ?? null)}`;
    pushTo(indexes.byBucket, bucketKey, entry);
  }
}

/** Everything an uploaded row may fuzzy-match against: its own group+sheet,
 *  records of its group that have no recorded sheet (imported before that
 *  field existed), and the pre-importer records that have no group at all.
 *  The three keys are deduplicated so a sheet whose name normalises to ""
 *  does not pull the no-sheet bucket in twice. */
function candidatePool(indexes: MatchIndexes, group: ImportGroup, sheetName: string): IndexedEstablishment[] {
  const keys = new Set([`${group}|${normText(sheetName)}`, `${group}|`, NO_GROUP]);
  return [...keys].flatMap((key) => indexes.byBucket.get(key) ?? []);
}

function uniqueById(ests: Establishment[]): Establishment[] {
  const seen = new Set<string>();
  return ests.filter((e) => {
    if (seen.has(e.id)) return false;
    seen.add(e.id);
    return true;
  });
}

/** The record's address as one piece of text: the plain string the oldest
 *  records hold, or `fullAddress` of the structured object the web form
 *  writes (see barangayOfEstablishment for the shapes in the wild). The
 *  object's bare `street` is deliberately NOT offered — "Purok 3" exists in
 *  every barangay, so equality with a fragment proves nothing. */
function addressTextOf(est: Establishment): string | null {
  const addr = est.address as unknown;
  if (typeof addr === "string") return addr;
  if (addr && typeof addr === "object" && typeof (addr as { fullAddress?: unknown }).fullAddress === "string") {
    return (addr as { fullAddress: string }).fullAddress;
  }
  return null;
}

/** Whether a row with no barangay and a same-named record share a second
 *  identifying fact. A trade name alone is not unique across a city ("JM
 *  Store"), so without one of these the row goes to review, not to renewal.
 *  Only recorded fields are compared — the owner, or the whole address text
 *  as typed — nothing is inferred from free text. */
function corroborates(row: MasterlistRow, est: Establishment): boolean {
  const rowOwner = normText(row.owner_name);
  if (rowOwner && rowOwner === normText(est.owner_name)) return true;

  const rowAddress = normText(row.address);
  return rowAddress !== "" && rowAddress === normText(addressTextOf(est));
}

function sameNameCandidates(ests: Establishment[]): ReviewCandidate[] {
  return ests.slice(0, MAX_REVIEW_CANDIDATES).map((e) => ({
    establishment: e,
    similarity: 1,
    reason: "same-name" as const,
  }));
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
  // Compared through permitKey, so "F-261174" and "F 261174" collide the way
  // they should. (Placeholders like "N/A" never reach here: the parser
  // stores them as null.)
  const rowPermitKey = row.business_permit_no ? permitKey(row.business_permit_no) : null;
  if (rowPermitKey) {
    const firstRowNumber = permitNosSeenInFile.get(rowPermitKey);
    if (firstRowNumber !== undefined) {
      return { kind: "duplicate-in-file", row, firstRowNumber };
    }
    permitNosSeenInFile.set(rowPermitKey, row.rowNumber);
  }

  const rowNameNorm = normText(row.business_name);
  const rowBarangayKey = barangayKeyOf(row.barangay);
  // A record this upload has already written — created, renewed or
  // permit-updated — takes no second row. See the header.
  const isUnclaimed = (est: Establishment) =>
    !indexes.createdThisRun.has(est.id) && !indexes.claimedThisRun.has(est.id);

  // Name similarity against the row, computed lazily and once.
  let rowBigrams: Map<string, number> | null = null;
  const similarityTo = (e: IndexedEstablishment): number => {
    if (!rowBigrams) rowBigrams = bigramsOf(rowNameNorm);
    return diceFromBigrams(rowBigrams, rowNameNorm.length, e.nameBigrams, e.nameNorm.length);
  };

  // The records sharing the row's TIN, consulted by step 2 and appended to
  // every review below so the panel can say "same TIN as X" even when X's
  // name looks nothing like the row's.
  const tin = normDigits(row.tin);
  const sameTin = tin ? (indexes.byTin.get(tin) ?? []) : [];

  /** A review decision, with the same-TIN records appended (deduplicated by
   *  id, the name-based reason winning). */
  const review = (primary: ReviewCandidate[]): MatchDecision => {
    const seen = new Set(primary.map((c) => c.establishment.id));
    const viaTin = sameTin
      .filter((e) => !seen.has(e.establishment.id))
      .map((e) => ({ establishment: e.establishment, similarity: similarityTo(e), reason: "same-tin" as const }));
    return { kind: "review", row, candidates: [...primary, ...viaTin] };
  };

  // Step 1 — permit number known: this exact permit was imported before and
  // management re-sent it (corrections, newly filled-in cells).
  if (rowPermitKey) {
    const byPermit = indexes.byPermitNo.get(rowPermitKey);
    if (byPermit) {
      if (isUnclaimed(byPermit)) {
        return { kind: "update-permit", row, establishment: byPermit };
      }
      // An earlier row already renewed this record under a NEW permit number,
      // and now its old number turns up as well: two permits for one record
      // in one file. A human decides which row is the real one.
      return review([{ establishment: byPermit, similarity: 1, reason: "same-permit" }]);
    }
  }

  // Step 2 — TIN: only the BPLO-layout sheets carry one. Same TIN plus the
  // same trade name is the strongest renewal signal there is — provided the
  // row's barangay, when it names one, agrees: barangay is part of identity
  // in this cascade (step 3), so TIN + name pointing at one record while the
  // barangay points at another is a conflict, not a match. Same TIN with a
  // DIFFERENT name is one owner's other business (or a renamed one), and
  // auto-merging it would fuse two inspection histories — so those records
  // are carried into whatever the later steps decide, and surface to a human
  // as "same-tin" candidates rather than ending the cascade here.
  let tinAmbiguous = false;
  if (rowNameNorm) {
    const sameTinAndName = sameTin.filter((e) => e.nameNorm === rowNameNorm && isUnclaimed(e.establishment));
    const agreeing = sameTinAndName.filter(
      (e) => rowBarangayKey === "" || e.barangayKey === "" || e.barangayKey === rowBarangayKey,
    );
    if (agreeing.length === 1) {
      return { kind: "renewal", row, establishment: agreeing[0].establishment, via: "tin" };
    }
    // Same TIN and name but the barangay disagrees, or several records fit:
    // the later steps may still find a same-named record, but must not renew
    // onto it on their own — the review they produce lists these via sameTin.
    tinAmbiguous = sameTinAndName.length > 0;
  }

  // Step 3 — exact identity: same group, same barangay, same trade name
  // (all through the canonicalised keys above). Checked against the row's
  // own group and against the pre-importer records that have none.
  if (rowNameNorm) {
    if (rowBarangayKey !== "") {
      const hits = [
        ...(indexes.byIdentity.get(`${group}|${rowBarangayKey}|${rowNameNorm}`) ?? []),
        ...(indexes.byIdentity.get(`${NO_GROUP}|${rowBarangayKey}|${rowNameNorm}`) ?? []),
      ];
      if (hits.length === 1 && isUnclaimed(hits[0]) && !tinAmbiguous) {
        return { kind: "renewal", row, establishment: hits[0], via: "identity" };
      }
      // Several same-named records in one barangay are branches; one that
      // this upload already wrote to is a repeated row. Either way, a human.
      if (hits.length > 0) return review(sameNameCandidates(hits));
    } else {
      // The BPLO-layout sheets carry no barangay column, so their rows can
      // never hit the keyed lookup against a record that HAS one. Compare by
      // name across the whole group instead (byGroupName — including records
      // that have a barangay and ones on other sheets), and renew only when
      // the match is unambiguous AND a second recorded fact agrees (same
      // owner, or the same address) — "JM Store" exists in more than one
      // barangay.
      const sameName = uniqueById([
        ...(indexes.byGroupName.get(`${group}|${rowNameNorm}`) ?? []),
        ...(indexes.byGroupName.get(`${NO_GROUP}|${rowNameNorm}`) ?? []),
      ]);
      if (sameName.length === 1 && isUnclaimed(sameName[0]) && !tinAmbiguous && corroborates(row, sameName[0])) {
        return { kind: "renewal", row, establishment: sameName[0], via: "identity" };
      }
      if (sameName.length > 0) return review(sameNameCandidates(sameName));
    }
  }

  // Step 4 — fuzzy: close-but-not-equal names within the same group (and
  // the same barangay — unless either side doesn't name one, in which case
  // the doubt goes to review rather than to a duplicate). These go to a human.
  if (rowNameNorm) {
    const candidates = candidatePool(indexes, group, row.sheetName)
      .filter((e) => rowBarangayKey === "" || e.barangayKey === "" || e.barangayKey === rowBarangayKey)
      .map((e) => ({
        establishment: e.establishment,
        similarity: similarityTo(e),
        reason: "similar-name" as const,
      }))
      .filter((c) => c.similarity >= REVIEW_THRESHOLD)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, MAX_REVIEW_CANDIDATES);

    if (candidates.length > 0) {
      return review(candidates);
    }
  }

  // Step 2, resumed — the TIN matched records with other names (or a
  // same-named one the barangay disagreed with) and nothing else claimed the
  // row: one owner's other business, or one that was renamed. Either way a
  // human decides; creating it blindly would risk a duplicate, merging it
  // blindly would fuse two histories.
  if (sameTin.length > 0) {
    return review([]);
  }

  // Step 5 — genuinely new.
  return { kind: "create", row };
}
