// [REF: MASTERLIST_MATCH_CASCADE]
//
// Decides what each parsed Excel row MEANS: a permit we already hold, last
// year's business renewing, a business we have never seen, or the rare case a
// human has to settle.
//
// WHAT IDENTIFIES A BUSINESS HERE: its trade name AND where it is. Both, and
// exactly. Two rules follow from that, and they are the whole design:
//
//   Same name at the same address  -> the same establishment.
//   Same name at a DIFFERENT address -> a different establishment. Not a
//   conflict, not a review: two businesses may legitimately share a name
//   (branches, or just a common one), and the city's own list carries plenty
//   of them. They are imported as separate records and merely reported.
//
// "Address" means barangay AND street, and a different BARANGAY settles it on
// its own — "Baliwag Lechon Manok" in Calicanto is not the branch in
// Alangilan, whether or not either row filled in a street. The street is only
// consulted when the barangay cannot separate them, which is also the only
// place a missing address can leave the question unanswerable.
//
// A permit number is checked first, but it identifies a permit-YEAR, not a
// business: a renewal is issued a fresh number, so "permit not found" is the
// normal yearly case and name+address is what actually recognises a renewal.
//
// NOTHING IS MATCHED ON SIMILARITY. An earlier version scored near-miss names
// with a bigram coefficient and sent anything above 0.6 to review. On the real
// 2026 workbooks that produced over 28,000 "similar" pairs in the first 1,200
// rows — "Thompson Resorts Limited Corporation" against "Manila City Resorts
// Corporation Inc." and thousands like it — because nearly every name on the
// list shares a word or a corporate suffix. The same files contain 9 rows that
// are genuinely the same business twice. A queue of 1,000 guesses hiding 9 real
// questions is worse than no queue, so the cascade now canonicalises hard
// (normalize.ts) and compares exactly. Do not reintroduce scoring.
//
// A TIN is deliberately NOT part of identity. It belongs to the OWNER, and one
// sole proprietor can hold several businesses — so a TIN match says "same
// person", which is not the question. It is still imported and stored; it just
// never decides anything.
//
// What a human is asked about, and only this:
//   - the same name at the same address already exists more than once
//   - the same name exists but one side records no street address, so
//     "different address?" cannot be answered
//   - a row lands on a record this same upload already wrote to
//   - a permit number reappears after that record was already renewed
//
// Identity is scoped by GROUP (food / non-food, i.e. which workbook).
// Establishments that predate the importer carry no group, so they are
// candidates for every upload rather than invisible to all of them.
//
// No database here: matching runs against in-memory indexes built from one
// establishment fetch, so the cascade costs zero reads per row. The caller owns
// the per-upload state — the permit numbers seen so far, and the ids this run
// has already written (see `claimedThisRun`).

import type { Establishment } from "@/lib/models";
import { barangayOfEstablishment, canonicalBarangay } from "@/lib/barangayGeo";
import type { MasterlistRow } from "./parseWorkbook";
import { locationKey, normText, permitKey } from "./normalize";

export type ImportGroup = "food" | "non_food";

/** Why a row reached a human. Each value is a different question, and the
 *  review panel words it differently — none of them is "these look alike". */
export type ReviewReason =
  /** Several existing records share this name and address, and the row's own
   *  sheet does not single one of them out, so which one is renewing is
   *  genuinely unknown. */
  | "same-name-same-address"
  /** Same name, but one side has no street address, so the
   *  different-address rule cannot be applied. */
  | "same-name-unknown-address"
  /** A row with NO permit number landed on a record this upload already
   *  wrote to. With a permit number the two would be separate activities;
   *  without one there is nothing to tell them apart. */
  | "already-claimed"
  /** The record's own earlier permit number turned up after it was renewed. */
  | "same-permit";

export interface ReviewCandidate {
  establishment: Establishment;
  reason: ReviewReason;
  /** The candidate's address as stored, so the panel can put it beside the
   *  row's address — that comparison IS the decision the admin is making. */
  addressText: string | null;
}

export type MatchDecision =
  | { kind: "update-permit"; row: MasterlistRow; establishment: Establishment }
  | { kind: "renewal"; row: MasterlistRow; establishment: Establishment }
  | { kind: "review"; row: MasterlistRow; candidates: ReviewCandidate[] }
  // `newId` is assigned by the caller, which also records it in
  // `claimedThisRun`, so a second row for the same business in one file is
  // recognised instead of creating it twice.
  //
  // Two kinds of near-neighbour are recorded on a create, neither of which
  // blocked it. Both exist only so the report can say what happened:
  //
  //   sameNameElsewhere        same name, another address — a different
  //                            business that happens to share a name.
  //   samePlaceDifferentPermit same name AND address, but this upload already
  //                            wrote a record under a DIFFERENT permit number.
  //                            One business holding several permits, one per
  //                            activity — Robinson's holds a bakery permit and
  //                            a cafe permit; Montemaria Resort holds six, one
  //                            per ride. Each is inspected against its own
  //                            checklist, so each is its own record.
  | {
      kind: "create";
      row: MasterlistRow;
      newId?: string;
      sameNameElsewhere: Establishment[];
      samePlaceDifferentPermit: Establishment[];
    }
  | { kind: "duplicate-in-file"; row: MasterlistRow; firstRowNumber: number };

/** At most this many candidates are carried into one review item: enough to
 *  decide, few enough to read. */
const MAX_REVIEW_CANDIDATES = 4;

/** Records with no `group` predate the importer; they live under this key and
 *  are candidates for EVERY upload. */
const NO_GROUP = "any";

/** One establishment reduced to the keys the cascade compares, computed once
 *  at index time. */
interface IndexedEstablishment {
  establishment: Establishment;
  nameKey: string;
  /** "" when the record names no street address beyond its barangay. */
  street: string;
  /** "" when the record names no barangay at all. */
  barangay: string;
  locationKey: string;
  /** Which masterlist sheet this record last came from. Not identity — a
   *  tiebreaker, for when several records share a name and address because the
   *  business holds one permit per activity (its bakery row and its cafe row).
   *  The sheet is the most stable hint the file gives about which is which. */
  sheet: string;
}

export interface MatchIndexes {
  /** permitKey -> the record holding that permit number. One permit-year
   *  belongs to one business, so one record per key is right. */
  byPermitNo: Map<string, Establishment>;
  /** group | nameKey | locationKey -> records with that exact identity.
   *  Normally one; more than one means the same business is already recorded
   *  twice at one address, which is a question for a human. */
  byIdentity: Map<string, IndexedEstablishment[]>;
  /** group | nameKey -> every record with that name, wherever it is. Used to
   *  tell "different address, so a different business" apart from "address
   *  unknown, so unanswerable". */
  byName: Map<string, IndexedEstablishment[]>;
  /** Ids this upload has already written — created, renewed or permit-updated.
   *  A second row landing on one of them goes to review: the first row already
   *  owns that record, and silently overwriting it would lose a row. */
  claimedThisRun: Set<string>;
}

/** The barangay as a comparison key: the canonical boundary spelling when the
 *  value resolves to one ("Bucal" and "Bukal" both become "Bukal"), the raw
 *  text otherwise. */
function barangayOf(raw: string | null | undefined): string {
  return canonicalBarangay(raw ?? null) ?? (raw ?? "");
}

function groupKeyOf(est: Establishment): string {
  return est.group === "food" || est.group === "non_food" ? est.group : NO_GROUP;
}

/** The record's address as one piece of text: the plain string most records
 *  hold, or `fullAddress` of the structured object the web form writes. The
 *  object's bare `street` is deliberately not used — "Purok 3" exists in every
 *  barangay, so matching on a fragment proves nothing. */
function addressTextOf(est: Establishment): string | null {
  const addr = est.address as unknown;
  if (typeof addr === "string") return addr;
  if (addr && typeof addr === "object" && typeof (addr as { fullAddress?: unknown }).fullAddress === "string") {
    return (addr as { fullAddress: string }).fullAddress;
  }
  return null;
}

function pushTo<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

export function buildMatchIndexes(existing: Establishment[]): MatchIndexes {
  const indexes: MatchIndexes = {
    byPermitNo: new Map(),
    byIdentity: new Map(),
    byName: new Map(),
    claimedThisRun: new Set(),
  };
  for (const est of existing) addToIndexes(indexes, est);
  return indexes;
}

/** Also called for every establishment this upload creates, so a business that
 *  appears twice in one file is recognised the second time. */
export function addToIndexes(indexes: MatchIndexes, est: Establishment): void {
  // barangayOfEstablishment, not est.barangay: legacy records keep their
  // barangay inside the structured address object, and reading the bare field
  // would leave them unmatchable by their own renewal.
  const location = locationKey(addressTextOf(est), barangayOf(barangayOfEstablishment(est)));
  const entry: IndexedEstablishment = {
    establishment: est,
    nameKey: normText(est.business_name),
    street: location.street,
    barangay: location.barangay,
    locationKey: location.key,
    sheet: normText(est.masterlist_sheet ?? null),
  };

  // Stored values are not validated the way parsed rows are — a legacy record
  // may hold "-" here — so the KEY is what has to be non-empty.
  const permit = est.business_permit_no == null ? "" : permitKey(String(est.business_permit_no));
  if (permit) indexes.byPermitNo.set(permit, est);

  if (entry.nameKey) {
    const groupKey = groupKeyOf(est);
    pushTo(indexes.byIdentity, `${groupKey}|${entry.nameKey}|${entry.locationKey}`, entry);
    pushTo(indexes.byName, `${groupKey}|${entry.nameKey}`, entry);
  }
}

export function decideRow(
  row: MasterlistRow,
  group: ImportGroup,
  indexes: MatchIndexes,
  permitNosSeenInFile: Map<string, number>,
): MatchDecision {
  // Step 0 — the same permit number twice in one upload is a spreadsheet
  // mistake, usually a copy-paste. Importing both would let the second
  // overwrite the first, so the second is set aside and reported. Compared
  // through permitKey, so "F-261174" and "F 261174" collide as they should.
  // (Placeholders like "N/A" never reach here; the parser stores them as null.)
  const rowPermit = row.business_permit_no ? permitKey(row.business_permit_no) : null;
  if (rowPermit) {
    const firstRowNumber = permitNosSeenInFile.get(rowPermit);
    if (firstRowNumber !== undefined) {
      return { kind: "duplicate-in-file", row, firstRowNumber };
    }
    permitNosSeenInFile.set(rowPermit, row.rowNumber);
  }

  const nameKey = normText(row.business_name);
  const rowLocation = locationKey(row.address, barangayOf(row.barangay));
  const isUnclaimed = (est: Establishment) => !indexes.claimedThisRun.has(est.id);

  const candidate = (e: IndexedEstablishment, reason: ReviewReason): ReviewCandidate => ({
    establishment: e.establishment,
    reason,
    addressText: addressTextOf(e.establishment),
  });

  // Step 1 — permit number already on a record: the same permit re-sent, with
  // corrections or newly filled-in cells.
  if (rowPermit) {
    const holder = indexes.byPermitNo.get(rowPermit);
    if (holder) {
      if (isUnclaimed(holder)) {
        return { kind: "update-permit", row, establishment: holder };
      }
      // An earlier row already renewed this record under a new permit number,
      // and now its old number arrives too: two permits for one record in one
      // file. A human decides which row is the live one.
      return {
        kind: "review",
        row,
        candidates: [{ establishment: holder, reason: "same-permit", addressText: addressTextOf(holder) }],
      };
    }
  }

  // A row with no trade name cannot be identified at all. The parser already
  // refuses those, so this is a guard rather than a path.
  if (!nameKey) return { kind: "create", row, sameNameElsewhere: [], samePlaceDifferentPermit: [] };

  const sameName = indexes.byName.get(`${group}|${nameKey}`) ?? [];
  const ungrouped = indexes.byName.get(`${NO_GROUP}|${nameKey}`) ?? [];
  const allSameName = [...sameName, ...ungrouped];

  // Step 2 — same name at the same address.
  const sameIdentity = allSameName.filter((e) => e.locationKey === rowLocation.key);
  if (sameIdentity.length > 0) {
    // Records THIS upload already wrote are a different situation from records
    // that were already in the database, so split them before deciding.
    const claimed = sameIdentity.filter((e) => !isUnclaimed(e.establishment));
    const available = sameIdentity.filter((e) => isUnclaimed(e.establishment));

    // Nothing left to renew onto: every same-identity record belongs to an
    // earlier row of THIS file. The city issues one permit per permitted
    // activity, so a second row at the same name and address carrying its own
    // permit number is a second activity, not a repeat — Robinson's bakery and
    // its cafe, each with its own permit and its own checklist. It becomes its
    // own record. (A row whose permit number genuinely repeats never reaches
    // here; step 0 set it aside.)
    //
    // Without a permit number there is nothing to tell the two apart, and that
    // is the one case a human has to settle.
    if (available.length === 0) {
      if (rowPermit) {
        return {
          kind: "create",
          row,
          sameNameElsewhere: [],
          samePlaceDifferentPermit: claimed.slice(0, MAX_REVIEW_CANDIDATES).map((e) => e.establishment),
        };
      }
      return {
        kind: "review",
        row,
        candidates: claimed.slice(0, MAX_REVIEW_CANDIDATES).map((e) => candidate(e, "already-claimed")),
      };
    }

    // Both sides must actually say where they are. With no street on either
    // side, "same address" only means "same barangay", which is not enough to
    // attach one business's inspection history to another.
    if (rowLocation.street === "" || available.some((e) => e.street === "")) {
      return {
        kind: "review",
        row,
        candidates: available.slice(0, MAX_REVIEW_CANDIDATES).map((e) => candidate(e, "same-name-unknown-address")),
      };
    }

    if (available.length === 1) {
      return { kind: "renewal", row, establishment: available[0].establishment };
    }

    // Several existing records share this name and address — the multi-permit
    // case again, seen from next year's file. The sheet is the tiebreaker: a
    // bakery row renews the record that came from the Bakery sheet. Only when
    // that still leaves more than one does a human decide.
    const onSameSheet = available.filter((e) => e.sheet === normText(row.sheetName));
    if (onSameSheet.length === 1) {
      return { kind: "renewal", row, establishment: onSameSheet[0].establishment };
    }
    return {
      kind: "review",
      row,
      candidates: (onSameSheet.length > 1 ? onSameSheet : available)
        .slice(0, MAX_REVIEW_CANDIDATES)
        .map((e) => candidate(e, "same-name-same-address")),
    };
  }

  // Step 3 — the name exists, but not at this address.
  const elsewhere = allSameName.filter((e) => e.locationKey !== rowLocation.key);
  if (elsewhere.length > 0) {
    // A DIFFERENT BARANGAY is already a different address, and nothing more is
    // needed to tell the two businesses apart — "BALIWAG LECHON MANOK" in
    // Calicanto is not the branch in Alangilan, whether or not either row
    // bothered to fill in a street. Records in another barangay therefore
    // never raise a question; they are only reported alongside the new record.
    const couldBeHere = elsewhere.filter(
      (e) => e.barangay === "" || rowLocation.barangay === "" || e.barangay === rowLocation.barangay,
    );

    // Same barangay (or a barangay missing on one side), and a street missing
    // on one side: now the street is the only thing that could tell them
    // apart, and it isn't there. That is the one unanswerable case.
    const unanswerable = couldBeHere.filter((e) => e.street === "" || rowLocation.street === "");
    if (unanswerable.length > 0) {
      return {
        kind: "review",
        row,
        candidates: unanswerable.slice(0, MAX_REVIEW_CANDIDATES).map((e) => candidate(e, "same-name-unknown-address")),
      };
    }

    // Every same-named record is either in another barangay, or on a street
    // that differs from this row's: a different business. Import it, and tell
    // the admin it happened.
    return {
      kind: "create",
      row,
      sameNameElsewhere: elsewhere.slice(0, MAX_REVIEW_CANDIDATES).map((e) => e.establishment),
      samePlaceDifferentPermit: [],
    };
  }

  // Step 4 — a name we have never seen.
  return { kind: "create", row, sameNameElsewhere: [], samePlaceDifferentPermit: [] };
}
