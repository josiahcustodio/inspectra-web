// FR-16 Masterlist Import: the match cascade that decides what each Excel row means.
import { describe, expect, test } from "vitest";
import type { Establishment } from "@/lib/models";
import type { MasterlistRow } from "./parseWorkbook";
import { addToIndexes, buildMatchIndexes, decideRow } from "./matchRows";

const est = (over: Partial<Establishment>): Establishment => ({
  id: over.id ?? "00000000-0000-4000-8000-000000000001",
  business_name: "Baliwag Lechon Manok",
  owner_name: null,
  address: "P. Burgos St.",
  barangay: "Cuta",
  qr_code_id: null,
  created_at: null,
  personnel_count: null,
  personnel_with_hc: null,
  sanitary_permit_no: null,
  control_no: null,
  category_id: null,
  category: null,
  group: "food",
  ...over,
} as Establishment);

const row = (over: Partial<MasterlistRow>): MasterlistRow => ({
  sheetName: "Food",
  rowNumber: 2,
  applic_type: "renewal",
  business_permit_no: null,
  permit_date_issued: null,
  business_name: "BALIWAG LECHON MANOK",
  line_of_business: null,
  floor_area_sqm: null,
  personnel_count: null,
  address: "P. Burgos Street",
  barangay: "Cuta",
  owner_name: null,
  tel_no: null,
  tin: null,
  import_date_inspected: null,
  import_sssr: null,
  import_remarks: null,
  ...over,
} as MasterlistRow);

describe("decideRow cascade", () => {
  test("a permit number already on record is an update of that permit, whatever the spelling", () => {
    const idx = buildMatchIndexes([est({ business_permit_no: "F-261174" })]);
    const d = decideRow(row({ business_permit_no: "f 261174" }), "food", idx, new Map());
    expect(d.kind).toBe("update-permit");
  });

  test("same name at the same address with a fresh permit number is a renewal", () => {
    const idx = buildMatchIndexes([est({ business_permit_no: "F-2025-1" })]);
    const d = decideRow(row({ business_permit_no: "F-2026-9" }), "food", idx, new Map());
    expect(d.kind).toBe("renewal");
    if (d.kind === "renewal") expect(d.establishment.id).toBe("00000000-0000-4000-8000-000000000001");
  });

  test("same name in a different barangay is a different business: created and reported, not reviewed", () => {
    const idx = buildMatchIndexes([est({ barangay: "Alangilan", address: null })]);
    const d = decideRow(row({ address: null }), "food", idx, new Map());
    expect(d.kind).toBe("create");
    if (d.kind === "create") expect(d.sameNameElsewhere).toHaveLength(1);
  });

  test("same name, same barangay, but no street on one side is the one unanswerable case", () => {
    const idx = buildMatchIndexes([est({ address: null })]);
    const d = decideRow(row({}), "food", idx, new Map());
    expect(d.kind).toBe("review");
    if (d.kind === "review") expect(d.candidates[0].reason).toBe("same-name-unknown-address");
  });

  test("the same permit number twice in one file sets the second row aside", () => {
    const idx = buildMatchIndexes([]);
    const seen = new Map<string, number>();
    decideRow(row({ business_permit_no: "F-1", rowNumber: 2 }), "food", idx, seen);
    const d = decideRow(row({ business_permit_no: "F 1", rowNumber: 9 }), "food", idx, seen);
    expect(d).toMatchObject({ kind: "duplicate-in-file", firstRowNumber: 2 });
  });

  test("a second row with no permit landing on a record this upload already wrote goes to review", () => {
    const idx = buildMatchIndexes([est({})]);
    idx.claimedThisRun.add("00000000-0000-4000-8000-000000000001");
    const d = decideRow(row({}), "food", idx, new Map());
    expect(d.kind).toBe("review");
    if (d.kind === "review") expect(d.candidates[0].reason).toBe("already-claimed");
  });

  test("a second row WITH its own permit at the same place is a second permitted activity, not a repeat", () => {
    const idx = buildMatchIndexes([est({})]);
    idx.claimedThisRun.add("00000000-0000-4000-8000-000000000001");
    const d = decideRow(row({ business_permit_no: "F-77" }), "food", idx, new Map());
    expect(d.kind).toBe("create");
    if (d.kind === "create") expect(d.samePlaceDifferentPermit).toHaveLength(1);
  });

  test("a name never seen is created", () => {
    const d = decideRow(row({ business_name: "Totally New Eatery" }), "food", buildMatchIndexes([]), new Map());
    expect(d).toMatchObject({ kind: "create", sameNameElsewhere: [], samePlaceDifferentPermit: [] });
  });

  test("identity is scoped by workbook group; ungrouped legacy records match every upload", () => {
    const legacy = est({ group: null as unknown as Establishment["group"] });
    const nonFood = est({ id: "00000000-0000-4000-8000-000000000002", group: "non_food" });
    const idx = buildMatchIndexes([legacy, nonFood]);
    const d = decideRow(row({ business_permit_no: "F-2" }), "food", idx, new Map());
    expect(d.kind).toBe("renewal");
    if (d.kind === "renewal") expect(d.establishment.id).toBe(legacy.id);
  });

  test("Bucal and Bukal are the same barangay", () => {
    const idx = buildMatchIndexes([est({ barangay: "Bucal" })]);
    expect(decideRow(row({ barangay: "Bukal", business_permit_no: "F-3" }), "food", idx, new Map()).kind).toBe("renewal");
  });

  test("addToIndexes lets a business that appears twice in one file be recognised the second time", () => {
    const idx = buildMatchIndexes([]);
    addToIndexes(idx, est({ id: "00000000-0000-4000-8000-00000000000a" }));
    idx.claimedThisRun.add("00000000-0000-4000-8000-00000000000a");
    expect(decideRow(row({}), "food", idx, new Map()).kind).toBe("review");
  });
});
