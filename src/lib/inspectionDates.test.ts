// FR-09 Inspection Record History: the two timestamp shapes must never be read the same way.
import { describe, expect, test } from "vitest";
import { byNewestFirst, isoDatePart, isoTimePart, latestLogByEstablishment } from "./inspectionDates";

describe("isoDatePart / isoTimePart", () => {
  test("a zone-less wall clock written by the mobile app is shown exactly as written", () => {
    expect(isoDatePart("2026-09-28T23:30:00.000")).toBe("2026-09-28");
    expect(isoTimePart("2026-09-28T23:30:00.000")).toBe("23:30");
  });
  test("a date-only value has a day but no time", () => {
    expect(isoDatePart("2026-09-28")).toBe("2026-09-28");
    expect(isoTimePart("2026-09-28")).toBe("");
  });
  test("a true instant is converted to the local day instead of being sliced", () => {
    const at = new Date("2026-09-28T23:00:00.000Z");
    const expected = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}`;
    expect(isoDatePart("2026-09-28T23:00:00.000Z")).toBe(expected);
  });
  test("absent, malformed and non-string values read 'No Date' rather than 'Invalid Date'", () => {
    expect(isoDatePart(null)).toBe("No Date");
    expect(isoDatePart("garbage")).toBe("No Date");
    expect(isoDatePart(1234 as unknown as string)).toBe("No Date");
  });
});

describe("ordering", () => {
  test("newest first, undated records sink to the bottom", () => {
    const logs = [
      { id: "a", inspection_date: "2026-01-01T00:00:00.000" },
      { id: "b", inspection_date: null },
      { id: "c", inspection_date: "2026-03-01T00:00:00.000" },
    ];
    expect([...logs].sort(byNewestFirst).map((l) => l.id)).toEqual(["c", "a", "b"]);
  });
  test("latestLogByEstablishment picks the newest dated log, or the only undated one", () => {
    const logs = [
      { id: "old", establishment_id: "e1", inspection_date: "2026-01-01" },
      { id: "new", establishment_id: "e1", inspection_date: "2026-02-01" },
      { id: "undated", establishment_id: "e2", inspection_date: null },
    ];
    const latest = latestLogByEstablishment(logs);
    expect(latest.get("e1")?.id).toBe("new");
    expect(latest.get("e2")?.id).toBe("undated");
  });
});
