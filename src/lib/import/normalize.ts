// [REF: MASTERLIST_NORMALIZE]
//
// Text normalisation and similarity scoring for the masterlist importer.
//
// The Excel masterlists are typed by hand, so the importer can never compare
// raw strings: "JB'S APARTMENT" and "JBs Apartment" are the same business.
// Every identity comparison goes through normText first, and anything that
// still doesn't match exactly is scored with a bigram Dice coefficient so a
// human can review the near-misses (the importer never auto-merges on fuzzy
// similarity — see [REF: MASTERLIST_MATCH_CASCADE]).

/** Lowercase, collapse every run of punctuation/whitespace to one space, trim.
 *  "JB'S APARTMENT" -> "jb s apartment", "Flr. Area (SqM.)" -> "flr area sqm". */
export function normText(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Keep digits only — for TIN and phone comparisons, where "287-016-784-000"
 *  and "287 016 784 000" must be the same key. */
export function normDigits(value: string | null | undefined): string {
  if (!value) return "";
  return value.replace(/\D+/g, "");
}

/** A permit number as a comparison key: upper-cased, with the spaces and
 *  dashes that vary between hand-typed spellings removed, so "F-261174",
 *  "F 261174" and "f-261174" all identify the same permit. Only comparisons
 *  go through here — the stored value keeps the spreadsheet's own spelling. */
export function permitKey(permitNo: string): string {
  return permitNo.toUpperCase().replace(/[\s-]+/g, "");
}

/** Character bigram counts of an ALREADY-normalised string.
 *
 *  Exposed separately from the similarity function so the matcher can build
 *  each establishment's bigrams once at index time instead of on every
 *  comparison — on a first import of a large category sheet, every new row
 *  is compared against every record so far, and rebuilding both bigram maps
 *  per comparison turned that into seconds of blocked UI. */
export function bigramsOf(normalized: string): Map<string, number> {
  const m = new Map<string, number>();
  for (let i = 0; i < normalized.length - 1; i++) {
    const bg = normalized.slice(i, i + 2);
    m.set(bg, (m.get(bg) ?? 0) + 1);
  }
  return m;
}

/** Dice coefficient over precomputed bigram maps, 0..1. */
export function diceFromBigrams(
  a: Map<string, number>,
  aLength: number,
  b: Map<string, number>,
  bLength: number,
): number {
  const total = Math.max(0, aLength - 1) + Math.max(0, bLength - 1);
  if (total === 0) return 0;
  // Iterate the smaller map: overlap is symmetric and this halves the work
  // when one name is much longer than the other.
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let overlap = 0;
  for (const [bg, count] of small) {
    overlap += Math.min(count, large.get(bg) ?? 0);
  }
  return (2 * overlap) / total;
}

/** Dice coefficient over character bigrams, 0..1.
 *
 *  Chosen over Levenshtein because it is insensitive to word order
 *  ("Aling Nena Eatery" vs "Eatery ni Aling Nena" still scores high), which
 *  is the most common way the same business is re-typed across masterlists.
 *  Inputs are normalised first so punctuation never affects the score. */
export function nameSimilarity(a: string, b: string): number {
  const x = normText(a);
  const y = normText(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  return diceFromBigrams(bigramsOf(x), x.length, bigramsOf(y), y.length);
}

/** A JS Date -> "YYYY-MM-DD", using local date parts.
 *
 *  Date-only strings are the one timestamp shape this codebase has never had
 *  trouble with (see lib/inspectionDates.ts for the trouble the other shapes
 *  cause) — no zone designator means no off-by-a-day bug, so masterlist dates
 *  are stored in exactly this form. */
export function toYmd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
