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
//      proprietor can hold several businesses. A TIN shared with records of
//      OTHER names does not end the cascade — those records ride along as
//      "same-tin" candidates on whatever review the later steps produce, and
//      force a review if nothing else claims the row.
//   3. Same group + barangay + trade name     -> same business, new permit (renewal),
//      but only when exactly ONE record fits. Two same-named records in one
//      barangay are branches, and a human picks which one renewed. A row with
//      no barangay (the BPLO sheets) needs a second corroborating fact — the
//      same owner, or the same address — because a bare trade name is not
//      unique across a city.
//   4. Similar trade name in the same place   -> REVIEW. Never auto-merged:
//      a wrong merge silently attaches one business's inspection history to
//      another, which is the worst corruption this system could produce.
//   5. Nothing                                -> new establishment
//
// Records created earlier in the SAME upload are never renewal targets. A
// renewal arrives with a new permit number, so a second row in one file that
// names a business this file has already created is either a duplicate row
// or a same-named branch — both a human call — and goes to review rather than
// merging into the first row's record and overwriting it.
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
// caller owns two pieces of per-upload state the cascade needs — the permit
// numbers seen so far in the file, and the records the upload is creating
// (see MatchDecision "create"). Names are normalised and bigram-counted once
// at index time — a first-ever import compares each new row against
// everything indexed so far, and doing that work per-comparison instead of
// per-record froze the tab on big sheets.

import type { Establishment } from "@/lib/models";
import { barangayOfEstablishment, canonicalBarangay } from "@/lib/barangayGeo";
import type { MasterlistRow } from "./parseWorkbook";
import { bigramsOf, diceFromBigrams, normDigits, normText, permitKey } from "./normalize";

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
  // document id, indexes the new record (addToIndexes) and adds the id to
  // `createdThisRun`, so a later row in the same upload naming this business
  // is caught — and sent to review — instead of creating it twice or quietly
  // merging into a record that has no history yet.
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
  /** Fuzzy/same-name candidate buckets. Keyed by group + SOURCE SHEET
   *  (`masterlist_sheet`, import bookkeeping — not a category): a whole
   *  food group is thousands of records and group-wide fuzzy matching
   *  drowns the review queue in cross-sheet lookalikes, while a renewal
   *  virtually always reappears on the same sheet it was on last year.
   *  A business that genuinely changed sheets is still caught by the exact
   *  identity key above, which stays group-wide. */
  byBucket: Map<string, IndexedEstablishment[]>;
  /** Ids of the records this upload is creating. The caller adds each one
   *  as it indexes the provisional record. They take part in matching like
   *  any other record — as review candidates — but are never renewal
   *  targets (see the header). */
  createdThisRun: Set<string>;
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
    byBucket: new Map(),
    createdThisRun: new Set(),
  };
  for (const est of existing) {
    addToIndexes(indexes, est);
  }
  return indexes;
}

/** Also called for every establishment the current import creates (with its
 *  id added to `createdThisRun` by the caller), so a business that appears
 *  twice in one upload is recognised the second time instead of being created
 *  twice. */
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

  const permitNo = (est.business_permit_no ?? "").trim();
  if (permitNo) indexes.byPermitNo.set(permitKey(permitNo), est);

  const tin = normDigits(est.tin ?? null);
  if (tin) pushTo(indexes.byTin, tin, entry);

  if (nameNorm) {
    const groupKey = groupKeyOf(est);
    pushTo(indexes.byIdentity, `${groupKey}|${entry.barangayKey}|${nameNorm}`, est);

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

/** The free-text parts of a record's address, whichever shape it uses (see
 *  barangayOfEstablishment for the three shapes in the wild). */
function addressTextsOf(est: Establishment): string[] {
  const addr = est.address as unknown;
  if (typeof addr === "string") return [addr];
  if (addr && typeof addr === "object") {
    const o = addr as { fullAddress?: unknown; street?: unknown };
    return [o.fullAddress, o.street].filter((v): v is string => typeof v === "string");
  }
  return [];
}

/** Whether a row with no barangay and a same-named record share a second
 *  identifying fact. A trade name alone is not unique across a city ("JM
 *  Store"), so without one of these the row goes to review, not to renewal.
 *  Only recorded fields are compared — the owner, or the address text as
 *  typed — nothing is inferred from free text. */
function corroborates(row: MasterlistRow, est: Establishment): boolean {
  const rowOwner = normText(row.owner_name);
  if (rowOwner && rowOwner === normText(est.owner_name)) return true;

  const rowAddress = normText(row.address);
  return rowAddress !== "" && addressTextsOf(est).some((text) => normText(text) === rowAddress);
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
  // A record this upload created has no permit history to renew — see header.
  const isRenewable = (est: Establishment) => !indexes.createdThisRun.has(est.id);

  // Step 1 — permit number known: this exact permit was imported before and
  // management re-sent it (corrections, newly filled-in cells).
  if (rowPermitKey) {
    const byPermit = indexes.byPermitNo.get(rowPermitKey);
    if (byPermit) {
      return { kind: "update-permit", row, establishment: byPermit };
    }
  }

  // Name similarity against the row, computed lazily and once.
  let rowBigrams: Map<string, number> | null = null;
  const similarityTo = (e: IndexedEstablishment): number => {
    if (!rowBigrams) rowBigrams = bigramsOf(rowNameNorm);
    return diceFromBigrams(rowBigrams, rowNameNorm.length, e.nameBigrams, e.nameNorm.length);
  };

  // Step 2 — TIN: only the BPLO-layout sheets carry one. Same TIN plus the
  // same trade name is the strongest renewal signal there is. Same TIN with
  // a DIFFERENT name is one owner's other business (or a renamed one), and
  // auto-merging it would fuse two inspection histories — so those records
  // are carried into whatever the later steps decide, and surface to a human
  // as "same-tin" candidates rather than ending the cascade here.
  const tin = normDigits(row.tin);
  const sameTin = tin ? (indexes.byTin.get(tin) ?? []) : [];
  if (rowNameNorm) {
    const exact = sameTin.filter((e) => e.nameNorm === rowNameNorm && isRenewable(e.establishment));
    if (exact.length === 1) {
      return { kind: "renewal", row, establishment: exact[0].establishment, via: "tin" };
    }
  }

  /** A review decision, with the same-TIN records appended (deduplicated by
   *  id, the name-based reason winning) so the panel can say "same TIN as X"
   *  even when X's name looks nothing like the row's. */
  const review = (primary: ReviewCandidate[]): MatchDecision => {
    const seen = new Set(primary.map((c) => c.establishment.id));
    const viaTin = sameTin
      .filter((e) => !seen.has(e.establishment.id))
      .map((e) => ({ establishment: e.establishment, similarity: similarityTo(e), reason: "same-tin" as const }));
    return { kind: "review", row, candidates: [...primary, ...viaTin] };
  };

  // Step 3 — exact identity: same group, same barangay, same trade name
  // (all through the canonicalised keys above). Checked against the row's
  // own group and against the pre-importer records that have none.
  if (rowNameNorm) {
    if (rowBarangayKey !== "") {
      const hits = [
        ...(indexes.byIdentity.get(`${group}|${rowBarangayKey}|${rowNameNorm}`) ?? []),
        ...(indexes.byIdentity.get(`${NO_GROUP}|${rowBarangayKey}|${rowNameNorm}`) ?? []),
      ];
      if (hits.length === 1 && isRenewable(hits[0])) {
        return { kind: "renewal", row, establishment: hits[0], via: "identity" };
      }
      // Several same-named records in one barangay are branches; one that
      // this upload itself created is a repeated row. Either way, a human.
      if (hits.length > 0) return review(sameNameCandidates(hits));
    } else {
      // The BPLO-layout sheets carry no barangay column, so their rows can
      // never hit the keyed lookup against a record that HAS one. An exact
      // name within the group is a renewal only when it is unambiguous AND a
      // second fact agrees (same owner, or the same address) — "JM Store"
      // exists in more than one barangay.
      const sameName = uniqueById([
        ...candidatePool(indexes, group, row.sheetName)
          .filter((e) => e.nameNorm === rowNameNorm)
          .map((e) => e.establishment),
        ...(indexes.byIdentity.get(`${group}||${rowNameNorm}`) ?? []),
        ...(indexes.byIdentity.get(`${NO_GROUP}||${rowNameNorm}`) ?? []),
      ]);
      if (sameName.length === 1 && isRenewable(sameName[0]) && corroborates(row, sameName[0])) {
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

  // Step 2, resumed — the TIN matched records with other names and nothing
  // else claimed the row: one owner's other business, or one that was
  // renamed. Either way a human decides; creating it blindly would risk a
  // duplicate, merging it blindly would fuse two histories.
  if (sameTin.length > 0) {
    return review([]);
  }

  // Step 5 — genuinely new.
  return { kind: "create", row };
}
