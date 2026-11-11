// FR-14 AI-Assisted Barangay Compliance Report: the scope figures the AI narrative must agree with.
import { describe, expect, test } from "vitest";
import type { Establishment, InspectionLog } from "@/lib/models";
import { barangayOfEstablishment, buildScopePreview, MAX_RANGE_DAYS, rangeInstants } from "./complianceReportScope";

const est = (id: string, barangay: string | null, address: unknown = null) =>
  ({ id, business_name: id, barangay, address } as unknown as Establishment);

const log = (over: Partial<InspectionLog>): InspectionLog =>
  ({
    id: Math.random().toString(36).slice(2),
    establishment_id: "e1",
    establishment_name: "Shop",
    inspector_name: null,
    total_demerits: null,
    percentage_rating: 80,
    remarks: null,
    inspection_date: "2026-06-15T10:00:00.000",
    photo_evidence_url: null,
    ...over,
  }) as InspectionLog;

describe("rangeInstants (whole Manila days)", () => {
  test("a day range becomes exact instants in UTC+8", () => {
    expect(rangeInstants("2026-06-01", "2026-06-30")).toEqual({
      from: "2026-05-31T16:00:00.000Z",
      to: "2026-06-30T15:59:59.999Z",
    });
  });
  test("a reversed range and a malformed date are rejected", () => {
    expect(rangeInstants("2026-06-30", "2026-06-01")).toBeNull();
    expect(rangeInstants("not-a-date", "2026-06-01")).toBeNull();
  });
  test(`more than ${MAX_RANGE_DAYS} days is rejected, exactly that many is allowed`, () => {
    expect(rangeInstants("2025-01-01", "2026-01-02")).toBeNull();
    expect(rangeInstants("2025-01-01", "2026-01-01")).not.toBeNull();
  });
});

describe("barangayOfEstablishment fallback order", () => {
  test("column, then legacy string address, then address.barangay", () => {
    expect(barangayOfEstablishment(est("a", "Alangilan"))).toBe("Alangilan");
    expect(barangayOfEstablishment(est("b", null, "Kumintang Ibaba"))).toBe("Kumintang Ibaba");
    expect(barangayOfEstablishment(est("c", null, { barangay: "Pallocan West" }))).toBe("Pallocan West");
    expect(barangayOfEstablishment(est("d", null))).toBeNull();
  });
});

describe("buildScopePreview", () => {
  const range = rangeInstants("2026-06-01", "2026-06-30")!;
  const ests = [est("e1", "Cuta"), est("e2", "Alangilan")];

  test("counts, average, bands, unscored and the Unknown bucket", () => {
    const logs = [
      log({ establishment_id: "e1", percentage_rating: 95 }),
      log({ establishment_id: "e1", percentage_rating: 60 }),
      log({ establishment_id: "e2", percentage_rating: 75 }),
      log({ establishment_id: "e2", percentage_rating: null }),
      log({ establishment_id: "ghost", establishment_name: "Orphan" }), // no establishment → Unknown
      log({ establishment_id: "e1", inspection_date: "2026-07-01T00:00:00.000" }), // outside the range
      log({ establishment_id: "e1", inspection_date: null }), // dateless: dropped
    ];
    const p = buildScopePreview(logs, ests, range, new Set());
    expect(p.inspections).toBe(5);
    expect(p.establishments).toBe(3);
    expect(p.unscored).toBe(1);
    expect(p.averageRating).toBe(Math.round((95 + 60 + 75 + 80) / 4));
    expect(p.bands).toEqual({ excellent: 1, verySatisfactory: 2, satisfactory: 1 });
    expect(p.barangays.map((b) => b.name)).toEqual(["Alangilan", "Cuta", "Unknown"]);
    expect(p.selectedBarangays).toBe(3);
  });

  test("an excluded barangay still appears in the barangay list but counts for nothing else", () => {
    const logs = [log({ establishment_id: "e1", percentage_rating: 50 }), log({ establishment_id: "e2", percentage_rating: 90 })];
    const p = buildScopePreview(logs, ests, range, new Set(["Cuta"]));
    expect(p.barangays).toEqual([
      { name: "Alangilan", inspections: 1 },
      { name: "Cuta", inspections: 1 },
    ]);
    expect(p.inspections).toBe(1);
    expect(p.selectedBarangays).toBe(1);
    expect(p.averageRating).toBe(90);
    expect(p.bands.satisfactory).toBe(0);
  });

  test("rows are ordered worst score first and keep the lowest score of the period", () => {
    const logs = [
      log({ establishment_id: "e1", percentage_rating: 90 }),
      log({ establishment_id: "e1", percentage_rating: 40 }),
      log({ establishment_id: "e2", percentage_rating: 70 }),
    ];
    const p = buildScopePreview(logs, ests, range, new Set());
    expect(p.rows.map((r) => [r.key, r.lowest, r.inspections])).toEqual([
      ["e1", 40, 2],
      ["e2", 70, 1],
    ]);
  });
});
