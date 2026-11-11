// FR-04 Dashboard, FR-07 High-Risk Barangay, Table 3 of the manuscript.
// Guards the band contract the mobile app mirrors in rating_scale.dart.
import { describe, expect, test } from "vitest";
import {
  complianceLabel,
  emptyBandCounts,
  isHighRisk,
  PASSING_SCORE,
  RATING_BANDS,
  ratingBand,
  ratingColor,
  ratingLabel,
  UNSCORED_LABEL,
} from "./ratingScale";

describe("rating bands (Table 3: 90-100 / 70-89 / 0-69, inclusive)", () => {
  test("boundaries land in the right band", () => {
    expect(ratingBand(100)).toBe("excellent");
    expect(ratingBand(90)).toBe("excellent");
    expect(ratingBand(89)).toBe("verySatisfactory");
    expect(ratingBand(70)).toBe("verySatisfactory");
    expect(ratingBand(69)).toBe("satisfactory");
    expect(ratingBand(0)).toBe("satisfactory");
  });

  test("a negative or malformed score falls to the lowest band instead of throwing", () => {
    expect(ratingBand(-5)).toBe("satisfactory");
  });

  test("the printable ranges are derived from the same bounds", () => {
    expect(RATING_BANDS.map((b) => b.range)).toEqual(["90–100", "70–89", "0–69"]);
  });

  test("the standard 20-item form at 5 points each: 0-2 fails Excellent, 3-6 Very Satisfactory, 7+ Satisfactory", () => {
    const score = (failed: number) => 100 - 5 * failed;
    expect(ratingBand(score(2))).toBe("excellent");
    expect(ratingBand(score(3))).toBe("verySatisfactory");
    expect(ratingBand(score(6))).toBe("verySatisfactory");
    expect(ratingBand(score(7))).toBe("satisfactory");
  });
});

describe("high-risk rule (mean score below the passing score)", () => {
  test("passing score is 70", () => {
    expect(PASSING_SCORE).toBe(70);
  });
  test("69 is high risk, 70 is not", () => {
    expect(isHighRisk(69)).toBe(true);
    expect(isHighRisk(70)).toBe(false);
  });
});

describe("labels and colours", () => {
  test("labels follow the band", () => {
    expect(ratingLabel(95)).toBe("Excellent");
    expect(ratingLabel(75)).toBe("Very Satisfactory");
    expect(ratingLabel(10)).toBe("Satisfactory");
  });
  test("an absent score reads as not yet inspected, in grey", () => {
    expect(ratingLabel(null)).toBe(UNSCORED_LABEL);
    expect(ratingLabel(undefined)).toBe(UNSCORED_LABEL);
    expect(ratingColor(null)).toBe("#94A3B8");
  });
  test("colours are green / amber / red", () => {
    expect(ratingColor(90)).toBe("#10B981");
    expect(ratingColor(70)).toBe("#F59E0B");
    expect(ratingColor(69)).toBe("#EF4444");
  });
  test("the establishments list calls the lowest band 'Fail' and nothing else", () => {
    expect(complianceLabel(50)).toBe("Fail");
    expect(complianceLabel(70)).toBe("Very Satisfactory");
    expect(complianceLabel(null)).toBe(UNSCORED_LABEL);
  });
  test("band counters start at zero for every band", () => {
    expect(emptyBandCounts()).toEqual({ excellent: 0, verySatisfactory: 0, satisfactory: 0 });
  });
});
