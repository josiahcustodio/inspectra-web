// FR-15 GIS Map, FR-07 High-Risk Barangay: the 105 boundaries and the name matching onto them.
import { describe, expect, test } from "vitest";
import { BARANGAY_NAMES, canonicalBarangay, normalizeBarangay } from "./barangayGeo";

describe("boundary set", () => {
  test("Batangas City has 105 barangays and every polygon has a distinct name", () => {
    expect(BARANGAY_NAMES).toHaveLength(105);
    expect(new Set(BARANGAY_NAMES).size).toBe(105);
  });
});

describe("canonicalBarangay", () => {
  test("exact and case-insensitive names resolve", () => {
    expect(canonicalBarangay("Alangilan")).toBe("Alangilan");
    expect(canonicalBarangay("ALANGILAN")).toBe("Alangilan");
  });
  test("saint abbreviations, city qualifiers and punctuation are ignored", () => {
    expect(canonicalBarangay("Sta. Clara")).toBe("Santa Clara");
    expect(canonicalBarangay("Alangilan, Batangas City")).toBe("Alangilan");
    expect(normalizeBarangay("Barangay 22 (Pob.)")).toBe("barangay 22");
  });
  test("numbered poblacion spellings resolve to the official 'Barangay N (Pob.)'", () => {
    expect(canonicalBarangay("Poblacion 22")).toBe("Barangay 22 (Pob.)");
    expect(canonicalBarangay("Brgy 05")).toBe("Barangay 5 (Pob.)");
  });
  test("recorded alias spellings fold onto the boundary name", () => {
    expect(canonicalBarangay("Bucal")).toBe("Bukal");
    expect(canonicalBarangay("Tingga Labac")).toBe("Tinga Labak");
    expect(canonicalBarangay("Santa Rita Carsada")).toBe("Santa Rita Karsada");
  });
  test("a whole address resolves to the LAST barangay named in it", () => {
    expect(canonicalBarangay("Duluhan, Cuta, Batangas City")).toBe("Cuta");
    expect(canonicalBarangay("San Pedro Street, Alangilan, Batangas City")).toBe("Alangilan");
  });
  test("unknown text and empty values resolve to nothing rather than a guess", () => {
    expect(canonicalBarangay("Narnia")).toBeNull();
    expect(canonicalBarangay("")).toBeNull();
    expect(canonicalBarangay(null)).toBeNull();
  });
});
