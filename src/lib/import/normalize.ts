// [REF: MASTERLIST_NORMALIZE]
//
// Text normalisation for the masterlist importer.
//
// The Excel masterlists are typed by hand, so the importer can never compare
// raw strings: "JB'S APARTMENT" and "JBs Apartment" are the same business.
// Every identity comparison goes through these helpers first, and then the
// comparison itself is EXACT — see [REF: MASTERLIST_MATCH_CASCADE].
//
// There used to be a bigram similarity score here, used to send near-miss
// names to review. It was removed because it does not work on this data:
// nearly every name on the city list carries a shared word or a corporate
// suffix, so unrelated businesses score as lookalikes. Measured on the real
// 2026 workbooks, a 0.6 cutoff produced over 28,000 "similar" pairs within
// the first 1,200 rows — against 9 rows that were genuinely the same
// business — so every real conflict arrived buried in noise. Canonicalise
// hard, then compare exactly; do not reintroduce scoring.

// The declared parameter types say string, but these helpers also run on
// values read straight off database rows (owner_name, tin, ...), which
// other clients and console edits have stored as numbers. A non-string is
// coerced rather than left to throw: one odd record must not abort a whole
// import. Objects are the caller's problem (see addressTextOf in matchRows).
function asText(value: unknown): string {
  if (value == null) return "";
  return typeof value === "string" ? value : String(value);
}

/** Lowercase, collapse every run of punctuation/whitespace to one space, trim.
 *  "JB'S APARTMENT" -> "jb s apartment", "Flr. Area (SqM.)" -> "flr area sqm". */
export function normText(value: string | null | undefined): string {
  return asText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// There was a normDigits() here, for comparing TINs with the punctuation
// stripped. It went when the TIN stopped taking part in matching: a TIN
// identifies the OWNER, and one sole proprietor can hold several businesses,
// so a TIN match answers a question the importer is not asking. The field is
// still parsed and stored — it just decides nothing.

/** A permit number as a comparison key: upper-cased, with the spaces and
 *  dashes that vary between hand-typed spellings removed, so "F-261174",
 *  "F 261174" and "f-261174" all identify the same permit. Only comparisons
 *  go through here — the stored value keeps the parser's spelling (upper-cased,
 *  spaces and dashes as typed). */
export function permitKey(permitNo: string): string {
  return asText(permitNo).toUpperCase().replace(/[\s-]+/g, "");
}

// Address words the city writes both ways. Expanding them is what makes
// "15th Drive St." and "15th Drive Street" one address instead of two — the
// difference between recognising next year's renewal and filing a duplicate.
// This is canonicalisation, not guessing: each entry is a fixed pair, so the
// result is the same on every machine and can be explained to an admin.
// Add to it only from spellings actually seen in a workbook.
const ADDRESS_WORDS: Record<string, string> = {
  st: "street", str: "street", ave: "avenue", av: "avenue",
  rd: "road", blvd: "boulevard", hwy: "highway", drv: "drive", dr: "drive",
  brgy: "barangay", bgy: "barangay", bo: "barangay", pob: "poblacion",
  blk: "block", lt: "lot", bldg: "building", subd: "subdivision",
  cor: "corner", no: "number", nr: "number", unt: "unit", ext: "extension",
};

/** An address as a comparison key: lowercased, punctuation dropped, and the
 *  abbreviations above expanded. Word ORDER is preserved on purpose — a token
 *  set would make "Blk 1 Lot 2" and "Blk 2 Lot 1" the same place. */
export function addressKey(value: string | null | undefined): string {
  const words = normText(value).split(" ").filter(Boolean);
  return words.map((w) => ADDRESS_WORDS[w] ?? w).join(" ");
}

/** Where a business is, as one comparison key: its street address plus its
 *  barangay. This is half of an establishment's identity — the other half is
 *  the trade name — because a name on its own is not unique in a city, while
 *  the same name at a different address is a different business.
 *
 *  `barangayCanonical` is passed in rather than resolved here so this module
 *  stays free of the barangay boundary data; the matcher supplies it through
 *  canonicalBarangay, which folds alias spellings ("Bucal"/"Bukal").
 *
 *  A barangay named inside the address text is removed before the barangay is
 *  appended, so a row that spells the barangay in the address column matches a
 *  record that keeps it in its own field. `street` comes back empty when the
 *  address says nothing beyond the barangay — the matcher treats that as
 *  "location unknown" and asks a human rather than guessing. */
export function locationKey(
  addressText: string | null | undefined,
  barangayCanonical: string | null | undefined,
): { street: string; barangay: string; key: string } {
  const barangay = addressKey(barangayCanonical);
  const barangayWords = new Set(barangay.split(" ").filter(Boolean));

  const street = addressKey(addressText)
    .split(" ")
    .filter((w) => w && !barangayWords.has(w))
    .join(" ");

  return { street, barangay, key: `${street}#${barangay}` };
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
