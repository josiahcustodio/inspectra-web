// [REF: RATING_SCALE]
// The one place the sanitary rating bands are defined for the web dashboard.
//
// A score is a whole percentage from 0 to 100 (it starts at 100 and each failed
// checklist item deducts that item's demerit weight), and every score falls
// into exactly one of three bands:
//
//    0 – 69   Satisfactory       red
//   70 – 89   Very Satisfactory  yellow
//   90 – 100  Excellent          green
//
// The Flutter app mirrors this in `lib/core/rating_scale.dart`. If a band,
// label or colour ever changes, change it in both places together.

export type RatingBand = "excellent" | "verySatisfactory" | "satisfactory";

export interface RatingBandSpec {
  band: RatingBand;
  label: string;
  /** Inclusive lower bound of the band. */
  min: number;
  /** Inclusive upper bound of the band. */
  max: number;
  /** Human-readable range, derived from min/max — e.g. "70–89". */
  range: string;
  color: string;
}

// The bounds, names and colours, highest band first. This is the ONLY place a
// threshold number is written: `ratingBandSpec()` classifies by reading `min`
// from this table rather than repeating 90/70 in an if-ladder, and each band's
// printable `range` is formatted from the same two numbers. Change a bound here
// and the classifier, the legends and the help text all follow.
const BAND_DEFINITIONS: readonly Omit<RatingBandSpec, "range">[] = [
  { band: "excellent", label: "Excellent", min: 90, max: 100, color: "#10B981" },
  { band: "verySatisfactory", label: "Very Satisfactory", min: 70, max: 89, color: "#F59E0B" },
  { band: "satisfactory", label: "Satisfactory", min: 0, max: 69, color: "#EF4444" },
];

/** Highest band first, for legends, charts and summaries. */
export const RATING_BANDS: readonly RatingBandSpec[] = BAND_DEFINITIONS.map(b => ({
  ...b,
  range: `${b.min}–${b.max}`,
}));

// Shown in place of a band when a record has no score at all. On this side that
// always means "no inspection exists yet for this establishment" — the mobile
// app's equivalent constant says "Not Scored Yet", because there a null score
// means an inspection form that is open but not finished. Different states, so
// the wording is deliberately different.
export const UNSCORED_LABEL = "Not yet inspected";
export const UNSCORED_COLOR = "#94A3B8";

// The same absent score, read per LOG instead of per establishment. Here
// `UNSCORED_LABEL` would be a lie — the inspection exists, it just has no
// rating yet — so anything listing individual logs uses this instead. One
// spelling, shared with the Inspections list's status column.
export const UNSCORED_LOG_LABEL = "Scheduled";

/** The spec for one band, by name. */
export function bandSpec(band: RatingBand): RatingBandSpec {
  // The table is exhaustive over RatingBand, so this always resolves.
  return RATING_BANDS.find(b => b.band === band)!;
}

export function labelOfBand(band: RatingBand): string {
  return bandSpec(band).label;
}

export function colorOfBand(band: RatingBand): string {
  return bandSpec(band).color;
}

/** The score at or above which a rating is at least Very Satisfactory. */
export const PASSING_SCORE = bandSpec("verySatisfactory").min;

export function ratingBandSpec(score: number): RatingBandSpec {
  // Highest band first, so the first lower bound the score clears is its band.
  for (const spec of RATING_BANDS) {
    if (score >= spec.min) return spec;
  }
  // Unreachable for a 0–100 score; a negative one lands in the lowest band.
  return RATING_BANDS[RATING_BANDS.length - 1];
}

export function ratingBand(score: number): RatingBand {
  return ratingBandSpec(score).band;
}

export function ratingLabel(score: number | null | undefined): string {
  if (score === null || score === undefined) return UNSCORED_LABEL;
  return ratingBandSpec(score).label;
}

export function ratingColor(score: number | null | undefined): string {
  if (score === null || score === undefined) return UNSCORED_COLOR;
  return ratingBandSpec(score).color;
}

/** The Establishments list's wording for the latest inspection. The lowest
 *  band is a failed inspection in the office's own terms, so it reads "Fail"
 *  there; every other place keeps the band's formal label. Kept here so the
 *  two wordings cannot drift apart from the bands themselves. */
export function complianceLabel(score: number | null | undefined): string {
  if (score === null || score === undefined) return UNSCORED_LABEL;
  return ratingBand(score) === "satisfactory" ? "Fail" : ratingLabel(score);
}

/** True when a score sits in the lowest band — the one that needs follow-up. */
export function isHighRisk(score: number): boolean {
  return score < PASSING_SCORE;
}

/** Zeroed counters keyed by band, for tallying a set of scores. */
export function emptyBandCounts(): Record<RatingBand, number> {
  return { excellent: 0, verySatisfactory: 0, satisfactory: 0 };
}
