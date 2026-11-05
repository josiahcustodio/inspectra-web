// [REF: AI_BARANGAY_SUMMARY] — scope half.
//
// What a report with these filters would cover, computed from rows the dashboard
// already holds, so previewing costs nothing and only Confirm calls the paid AI.
// The same range and barangay rules run server-side in
// supabase/functions/generate-barangay-summary/, which cannot import from src/.

import type { Establishment, InspectionLog } from "@/lib/models";
import { emptyBandCounts, ratingBand } from "@/lib/ratingScale";

/** The server rejects anything longer. */
export const MAX_RANGE_DAYS = 366;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Barangay column → legacy string address → address.barangay. */
export function barangayOfEstablishment(est: Pick<Establishment, "barangay" | "address">): string | null {
  if (est.barangay) return est.barangay;
  const addr = est.address as unknown;
  if (typeof addr === "string" && addr) return addr;
  if (addr && typeof addr === "object" && (addr as { barangay?: string }).barangay) return (addr as { barangay: string }).barangay;
  return null;
}

/** Manila's calendar date as yyyy-mm-dd, the format a date input uses. */
export const manilaDate = (date: Date) => date.toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });

/** The picked days as exact instants, whole days in Manila wherever the browser is. */
export function rangeInstants(fromDay: string, toDay: string): { from: string; to: string } | null {
  const from = new Date(`${fromDay}T00:00:00.000+08:00`);
  const to = new Date(`${toDay}T23:59:59.999+08:00`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) return null;
  if (to.getTime() - from.getTime() > MAX_RANGE_DAYS * DAY_MS) return null;
  return { from: from.toISOString(), to: to.toISOString() };
}

export interface ScopeRow {
  key: string;
  name: string;
  barangay: string;
  inspections: number;
  /** Lowest score in the range, like the report. Null when none were scored. */
  lowest: number | null;
}

export interface ScopePreview {
  /** Every barangay with inspections in the range, including excluded ones. */
  barangays: { name: string; inspections: number }[];
  rows: ScopeRow[];
  inspections: number;
  /** Counted the way the report counts: rows with a real establishment id. */
  establishments: number;
  selectedBarangays: number;
  averageRating: number | null;
  bands: ReturnType<typeof emptyBandCounts>;
  unscored: number;
}

export function buildScopePreview(
  logs: InspectionLog[],
  establishments: Establishment[],
  range: { from: string; to: string },
  excluded: ReadonlySet<string>,
): ScopePreview {
  const estBarangay = new Map<string, string>();
  for (const est of establishments) {
    const brgy = barangayOfEstablishment(est);
    if (brgy) estBarangay.set(est.id, brgy);
  }

  const from = new Date(range.from).getTime();
  const to = new Date(range.to).getTime();
  const counts = new Map<string, number>();
  const rows = new Map<string, ScopeRow>();
  const ids = new Set<string>();
  const bands = emptyBandCounts();
  let inspections = 0;
  let ratingSum = 0;
  let scored = 0;

  for (const log of logs) {
    // A dateless log can't be placed in a range; the server drops it too.
    if (!log.inspection_date) continue;
    const at = new Date(log.inspection_date).getTime();
    if (at < from || at > to) continue;

    const brgy = (log.establishment_id && estBarangay.get(log.establishment_id)) || "Unknown";
    counts.set(brgy, (counts.get(brgy) ?? 0) + 1);
    if (excluded.has(brgy)) continue;

    inspections++;
    if (log.establishment_id) ids.add(log.establishment_id);
    const name = log.establishment_name || "Unnamed establishment";
    const key = log.establishment_id ?? `${brgy}/${name}`;
    let row = rows.get(key);
    if (!row) {
      row = { key, name, barangay: brgy, inspections: 0, lowest: null };
      rows.set(key, row);
    }
    row.inspections++;

    const score = log.percentage_rating;
    if (score === null) continue;
    ratingSum += score;
    scored++;
    bands[ratingBand(score)]++;
    if (row.lowest === null || score < row.lowest) row.lowest = score;
  }

  return {
    barangays: [...counts.entries()].map(([name, n]) => ({ name, inspections: n })).sort((a, b) => a.name.localeCompare(b.name)),
    rows: [...rows.values()].sort((a, b) => (a.lowest ?? Infinity) - (b.lowest ?? Infinity) || a.name.localeCompare(b.name)),
    inspections,
    establishments: ids.size,
    selectedBarangays: [...counts.keys()].filter((name) => !excluded.has(name)).length,
    averageRating: scored > 0 ? Math.round(ratingSum / scored) : null,
    bands,
    unscored: inspections - scored,
  };
}
