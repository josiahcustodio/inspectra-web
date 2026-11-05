// Pure per-barangay aggregation for the AI compliance summary.
//
// No I/O in this file on purpose: index.ts does the fetching and the Claude
// call, this module turns raw rows into the compact digest the model reads.
// That split is what makes the numbers unit-testable (see aggregate.test.ts)
// without mocking Supabase or Anthropic.
//
// Three normalisation rules are COPIED from the web app and must stay in sync
// with it — an Edge Function cannot import from src/:
//   - rating bands (90 / 70 thresholds)  → src/lib/ratingScale.ts
//   - answer kinds (Pass/Fail/NA + legacy Compliant/Non-Compliant)
//                                         → src/components/InspectionChecklistView.tsx
//   - barangay fallback chain             → src/lib/complianceReportScope.ts

export interface LogRow {
  establishment_id: string | null;
  establishment_name: string | null;
  percentage_rating: number | null;
  remarks: string | null;
  inspection_date: string | null;
  // Per-item checklist answers. Shape is load-bearing but untyped in the web
  // app too (two clients write it): { item_name, answer, weight, note, ... }.
  results: any[] | null;
}

export interface EstablishmentRow {
  id: string;
  business_name: string | null;
  barangay: string | null;
  // Plain string on legacy rows, { barangay, ... } object on newer ones.
  address: unknown;
}

export interface BarangaySummary {
  name: string;
  inspections: number;
  establishments_inspected: number;
  /** Mean of scored inspections, whole percent. Null when none were scored. */
  average_rating: number | null;
  // NOTE the scale's counterintuitive naming: "satisfactory" is the LOWEST
  // band (0–69, red / high-risk). Mirrors ratingScale.ts.
  bands: { excellent: number; very_satisfactory: number; satisfactory: number; unscored: number };
  /** Most frequently failed checklist items — the "recurring violations". */
  top_failed_items: { item: string; failures: number }[];
  /** Worst performers, one entry per establishment (its lowest score). */
  lowest_rated: { establishment: string; rating: number }[];
  /** Free-text inspector remarks / per-item notes, trimmed for the prompt. */
  inspector_notes: string[];
}

// Digest caps. These exist to bound the prompt, not the analysis: counts and
// averages are computed over ALL rows; only the illustrative lists are cut.
const TOP_FAILED_ITEMS = 5;
const LOWEST_RATED = 3;
const NOTES_PER_BARANGAY = 6;
const NOTE_MAX_CHARS = 240;

/** Dashboard's fallback chain: barangay column → legacy string address → address.barangay. */
export function barangayOf(est: EstablishmentRow): string | null {
  if (est.barangay) return est.barangay;
  const addr = est.address;
  if (typeof addr === "string" && addr) return addr;
  if (addr && typeof addr === "object" && (addr as any).barangay) return (addr as any).barangay;
  return null;
}

/** Mirrors InspectionChecklistView.answerKind — anything else is Pass or N/A. */
export function isFailedAnswer(answer: unknown): boolean {
  const a = String(answer ?? "").toLowerCase();
  return a === "fail" || a === "non-compliant";
}

/** Mirrors ratingScale.ts bands: ≥90 excellent, ≥70 very satisfactory, else satisfactory (lowest). */
export function bandOf(score: number): "excellent" | "very_satisfactory" | "satisfactory" {
  if (score >= 90) return "excellent";
  if (score >= 70) return "very_satisfactory";
  return "satisfactory";
}

/** Resolves a log to its barangay's bucket name. */
export function logBarangayResolver(establishments: EstablishmentRow[]): (log: LogRow) => string {
  const estBarangay = new Map<string, string>();
  for (const est of establishments) {
    const brgy = barangayOf(est);
    if (brgy) estBarangay.set(est.id, brgy);
  }
  // Same bucket the dashboard uses for logs whose establishment has no
  // barangay (or no establishment at all) — dropping them would make the
  // report disagree with the dashboard's totals.
  return (log) => (log.establishment_id && estBarangay.get(log.establishment_id)) || "Unknown";
}

export function aggregate(logs: LogRow[], establishments: EstablishmentRow[]): BarangaySummary[] {
  const barangayOfLog = logBarangayResolver(establishments);

  interface Acc {
    inspections: number;
    establishmentIds: Set<string>;
    ratingSum: number;
    ratingCount: number;
    bands: BarangaySummary["bands"];
    failedItems: Map<string, number>;
    // One entry per establishment, keeping its lowest score of the window —
    // "this place scored 42 once" beats averaging it away.
    worstByEstablishment: Map<string, number>;
    notes: string[];
  }
  const byBarangay = new Map<string, Acc>();

  for (const log of logs) {
    const brgy = barangayOfLog(log);

    let acc = byBarangay.get(brgy);
    if (!acc) {
      acc = {
        inspections: 0,
        establishmentIds: new Set(),
        ratingSum: 0,
        ratingCount: 0,
        bands: { excellent: 0, very_satisfactory: 0, satisfactory: 0, unscored: 0 },
        failedItems: new Map(),
        worstByEstablishment: new Map(),
        notes: [],
      };
      byBarangay.set(brgy, acc);
    }

    acc.inspections++;
    if (log.establishment_id) acc.establishmentIds.add(log.establishment_id);

    const estName = log.establishment_name || "Unnamed establishment";
    const score = log.percentage_rating;
    if (score == null) {
      acc.bands.unscored++;
    } else {
      acc.ratingSum += score;
      acc.ratingCount++;
      acc.bands[bandOf(score)]++;
      const worst = acc.worstByEstablishment.get(estName);
      if (worst === undefined || score < worst) acc.worstByEstablishment.set(estName, score);
    }

    const addNote = (text: string | null | undefined) => {
      if (!text || acc!.notes.length >= NOTES_PER_BARANGAY) return;
      acc!.notes.push(`${estName} — ${text}`.slice(0, NOTE_MAX_CHARS));
    };
    addNote(log.remarks);

    for (const item of log.results ?? []) {
      if (!isFailedAnswer(item?.answer)) continue;
      const name = item?.item_name || "Unnamed checklist item";
      acc.failedItems.set(name, (acc.failedItems.get(name) ?? 0) + 1);
      if (item?.note) addNote(`${name}: ${item.note}`);
    }
  }

  const summaries: BarangaySummary[] = [...byBarangay.entries()].map(([name, acc]) => ({
    name,
    inspections: acc.inspections,
    establishments_inspected: acc.establishmentIds.size,
    average_rating: acc.ratingCount > 0 ? Math.round(acc.ratingSum / acc.ratingCount) : null,
    bands: acc.bands,
    top_failed_items: [...acc.failedItems.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, TOP_FAILED_ITEMS)
      .map(([item, failures]) => ({ item, failures })),
    lowest_rated: [...acc.worstByEstablishment.entries()]
      .sort((a, b) => a[1] - b[1])
      .slice(0, LOWEST_RATED)
      .map(([establishment, rating]) => ({ establishment, rating })),
    inspector_notes: acc.notes,
  }));

  // Busiest barangays first — index.ts gives the first N full narrative
  // sections and compresses the tail, so order doubles as editorial priority.
  return summaries.sort((a, b) => b.inspections - a.inspections);
}
