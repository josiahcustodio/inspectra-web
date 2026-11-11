// FR-16 Masterlist Import: the canonicalisation every identity comparison runs through.
import { describe, expect, test } from "vitest";
import { addressKey, locationKey, normText, permitKey, toYmd } from "./normalize";

describe("normText", () => {
  test("case, punctuation and spacing do not distinguish two spellings of one name", () => {
    expect(normText("JB'S APARTMENT")).toBe("jb s apartment");
    expect(normText("  JBs   Apartment ")).toBe("jbs apartment");
    expect(normText("Flr. Area (SqM.)")).toBe("flr area sqm");
  });
  test("absent and non-string values are tolerated, never thrown on", () => {
    expect(normText(null)).toBe("");
    expect(normText(undefined)).toBe("");
    expect(normText(12345 as unknown as string)).toBe("12345");
  });
});

describe("permitKey", () => {
  test("spaces, dashes and case collapse to one permit", () => {
    expect(permitKey("F-261174")).toBe("F261174");
    expect(permitKey("F 261174")).toBe("F261174");
    expect(permitKey("f-261174")).toBe("F261174");
  });
});

describe("addressKey", () => {
  test("street abbreviations expand so 'St.' and 'Street' are one address", () => {
    expect(addressKey("15th Drive St.")).toBe(addressKey("15th Drive Street"));
    expect(addressKey("Blk 1 Lot 2, Brgy. Cuta")).toBe("block 1 lot 2 barangay cuta");
  });
  test("word order is preserved: Blk 1 Lot 2 is not Blk 2 Lot 1", () => {
    expect(addressKey("Blk 1 Lot 2")).not.toBe(addressKey("Blk 2 Lot 1"));
  });
});

describe("locationKey", () => {
  test("a barangay named inside the address is folded into the barangay half", () => {
    const a = locationKey("P. Burgos St., Cuta", "Cuta");
    const b = locationKey("P. Burgos Street", "Cuta");
    expect(a.key).toBe(b.key);
    expect(a.street).toBe("p burgos street");
    expect(a.barangay).toBe("cuta");
  });
  test("an address that says nothing beyond the barangay leaves the street empty", () => {
    expect(locationKey("Cuta", "Cuta").street).toBe("");
    expect(locationKey(null, "Cuta").street).toBe("");
  });
});

describe("toYmd", () => {
  test("uses local date parts, zero-padded", () => {
    expect(toYmd(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(toYmd(new Date(2026, 11, 31))).toBe("2026-12-31");
  });
});
