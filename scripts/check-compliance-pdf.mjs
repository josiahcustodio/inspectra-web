// Run with:  node scripts/check-compliance-pdf.mjs [output-dir]
//
// Builds the compliance PDF from sample data without calling the API or Supabase.
// Asserts the layout survives a full and a near-empty report; pass an output dir
// to also write the PDFs and look at them after a design change.

import assert from "node:assert/strict";
import { rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const outDir = process.argv[2];
// Bare imports resolve from the importing file, so the bundle must sit in the repo tree.
const bundleDir = resolve("node_modules/.compliance-pdf-check");
await build({
  entryPoints: { pdf: "src/lib/complianceReportPdf.ts", scope: "src/lib/complianceReportScope.ts" },
  bundle: true,
  platform: "node",
  format: "esm",
  outdir: bundleDir,
  outExtension: { ".js": ".mjs" },
  alias: { "@": resolve("src") },
  external: ["jspdf", "jspdf-autotable"],
  logLevel: "error",
});
const load = (name) => import(pathToFileURL(join(bundleDir, `${name}.mjs`)).href);
const { buildComplianceReportPdf, complianceReportFileName, pdfText } = await load("pdf");
const { buildScopePreview, rangeInstants } = await load("scope");
rmSync(bundleDir, { recursive: true });

// The range covers whole Manila days: 23:30 UTC on Oct 31 is already Nov 1 there.
const range = rangeInstants("2026-11-01", "2026-11-30");
assert.equal(range.from, "2026-10-31T16:00:00.000Z");
assert.equal(range.to, "2026-11-30T15:59:59.999Z");
assert.equal(rangeInstants("2026-11-30", "2026-11-01"), null);
assert.equal(rangeInstants("", "2026-11-01"), null);
assert.equal(rangeInstants("2025-01-01", "2026-11-01"), null);

const establishments = [
  { id: "a", barangay: "Alangilan", address: null },
  { id: "c", barangay: null, address: { barangay: "Cuta" } },
];
const log = (establishment_id, percentage_rating, inspection_date, establishment_name = establishment_id) =>
  ({ establishment_id, establishment_name, percentage_rating, inspection_date });
const logs = [
  log("a", 60, "2026-10-31T23:30:00Z"),
  log("a", 95, "2026-11-02T01:00:00Z"),
  log("c", 80, "2026-11-03T01:00:00Z"),
  log("c", null, "2026-11-04T01:00:00Z"),
  log(null, 50, "2026-11-05T01:00:00Z", "Walk-in"),
  log("a", 10, "2026-10-31T15:59:00Z"), // Before the range.
  log("a", 10, null), // Dateless, like the server's filter.
];

const all = buildScopePreview(logs, establishments, range, new Set());
assert.deepEqual(all.barangays, [{ name: "Alangilan", inspections: 2 }, { name: "Cuta", inspections: 2 }, { name: "Unknown", inspections: 1 }]);
assert.equal(all.inspections, 5);
assert.equal(all.establishments, 2);
assert.equal(all.selectedBarangays, 3);
assert.equal(all.averageRating, 71); // (60 + 95 + 80 + 50) / 4
assert.deepEqual(all.bands, { excellent: 1, verySatisfactory: 1, satisfactory: 2 });
assert.equal(all.unscored, 1);
assert.deepEqual(all.rows.map((r) => [r.name, r.lowest]), [["Walk-in", 50], ["a", 60], ["c", 80]]);

// Excluding narrows the figures but keeps the barangay available to re-tick.
const some = buildScopePreview(logs, establishments, range, new Set(["Alangilan", "Unknown"]));
assert.equal(some.barangays.length, 3);
assert.equal(some.selectedBarangays, 1);
assert.equal(some.inspections, 2);
assert.equal(some.averageRating, 80);

assert.equal(pdfText("Rating ≥ 90 → Excellent 🎉"), "Rating >= 90 -> Excellent ");
assert.equal(pdfText("Dasmariñas — Sto. Niño’s"), "Dasmariñas — Sto. Niño’s");
assert.equal(pdfText("line one\nline two"), "line one\nline two");

const NAMES = ["Alangilan", "Kumintang Ibaba", "Pallocan West", "Sta. Rita Karsada", "Balagtas", "Cuta", "Poblacion 12", "Bolbok", "Santo Niño", "Gulod Labac", "Libjo", "Tingga Itaas", "Wawa", "Sorosoro Ibaba", "Malitam", "Talahib Pandayan", "Dumantay", "San Isidro", "Pinamucan", "A very long legacy address string, Purok 3, Barangay Mahabang Parang, Batangas City, Batangas"];

const digest = (name, i) => {
  const excellent = 2 + (i * 3) % 7, very_satisfactory = 5 + (i * 5) % 6, satisfactory = 1 + (i * 7) % 8;
  return {
    name,
    inspections: excellent + very_satisfactory + satisfactory,
    establishments_inspected: excellent + very_satisfactory,
    average_rating: 58 + (i * 11) % 38,
    bands: { excellent, very_satisfactory, satisfactory, unscored: i % 4 === 0 ? 1 : 0 },
    top_failed_items: [
      { item: "Waste segregation and disposal", failures: 9 - (i % 4) },
      { item: "Valid health certificates for all food handlers", failures: 6 - (i % 3) },
      { item: "Handwashing station with soap and running water", failures: 3 },
    ],
    lowest_rated: [
      { establishment: `Carinderia ni Aling Nena ${i + 1}`, rating: 48 + i },
      { establishment: `Sari-sari Store ${i + 1}`, rating: 61 + i },
    ],
  };
};

const barangays = NAMES.map(digest);
const full = {
  from: "2026-08-08T02:00:00.000Z",
  to: "2026-11-06T02:00:00.000Z",
  city: {
    name: "Unknown",
    inspections: 312,
    establishments_inspected: 241,
    average_rating: 76,
    bands: { excellent: 84, very_satisfactory: 151, satisfactory: 74, unscored: 3 },
    top_failed_items: [
      { item: "Waste segregation and disposal", failures: 96 },
      { item: "Valid health certificates for all food handlers", failures: 71 },
      { item: "Handwashing station with soap and running water", failures: 52 },
      { item: "Pest control records kept up to date and available for review during the inspection visit by the sanitary inspector", failures: 38 },
      { item: "Potable water test results", failures: 21 },
    ],
    lowest_rated: [
      { establishment: "Carinderia ni Aling Nena", rating: 41 },
      { establishment: "Santo Niño Bakery", rating: 44 },
      { establishment: "Sari-sari Store 7", rating: 49 },
    ],
  },
  barangays,
  scope_barangays: null,
  narrative: {
    executive_summary:
      "Batangas City averaged a Very Satisfactory rating of 76% across 312 inspections, but one in four scored inspections landed in the non-passing Satisfactory band. Risk is concentrated in a handful of barangays — Alangilan and Poblacion 12 account for a disproportionate share of failing scores. Waste segregation and lapsed health certificates are the most common violations and appear across most barangays. Coverage is thin in several smaller barangays, so their averages should be read with caution. The office should prioritize re-inspections of establishments scoring below 70 and run a focused drive on waste handling.",
    citywide_findings:
      "Failures cluster around a small number of basic sanitation items rather than being spread evenly across the checklist, which suggests that targeted orientation could lift many establishments at once. Food-service establishments feature heavily among the lowest scores, and inspector notes repeatedly mention mixed waste bins and expired health certificates.",
    barangays: NAMES.slice(0, 15).map((name) => ({
      name,
      assessment: `${name} shows a mixed picture: most establishments pass, but repeat waste-handling failures keep the average down. Inspector notes point to mixed bins and missing health certificates at food stalls, so a return visit focused on those items is likely to show quick improvement.`,
    })),
    other_barangays: "The remaining barangays each had few inspections, so their averages are indicative only. None showed a pattern that differs from the city-wide findings, but they should be included in the next inspection cycle to improve coverage.",
    recommended_actions: [
      { priority: "High", barangay: "Alangilan", action: "Re-inspect all establishments that scored below 70 within 30 days.", rationale: "Highest count of non-passing scores in the period." },
      { priority: "High", barangay: "Poblacion 12", action: "Issue sanitary orders to repeat offenders on waste segregation.", rationale: "Waste segregation failed repeatedly at the same establishments." },
      { priority: "Medium", barangay: "City-wide", action: "Run a health-certificate renewal drive with food-service operators.", rationale: "Second most common violation across most barangays." },
      { priority: "Low", barangay: "Smaller barangays", action: "Add these barangays to the next inspection cycle.", rationale: "Too few inspections to draw firm conclusions." },
    ],
  },
};

const thin = {
  from: full.from,
  to: full.to,
  city: { name: "Unknown", inspections: 1, establishments_inspected: 0, average_rating: null, bands: { excellent: 0, very_satisfactory: 0, satisfactory: 0, unscored: 1 }, top_failed_items: [], lowest_rated: [] },
  barangays: [{ name: "Unknown", inspections: 1, establishments_inspected: 0, average_rating: null, bands: { excellent: 0, very_satisfactory: 0, satisfactory: 0, unscored: 1 }, top_failed_items: [], lowest_rated: [] }],
  scope_barangays: ["Unknown"],
  narrative: { executive_summary: "Only one unscored inspection was recorded.", citywide_findings: "There is too little data to identify patterns.", barangays: [], other_barangays: "", recommended_actions: [] },
};

for (const [name, report, minPages] of [["full", full, 3], ["thin", thin, 1]]) {
  const { blob, pages } = await buildComplianceReportPdf(report);
  assert.equal(blob.type, "application/pdf");
  assert.ok(pages >= minPages, `${name}: expected at least ${minPages} pages, got ${pages}`);
  if (outDir) writeFileSync(join(outDir, `${name}.pdf`), Buffer.from(await blob.arrayBuffer()));
  console.log(`${name}: ${pages} pages, ${Math.round(blob.size / 1024)} KB`);
}
assert.equal(complianceReportFileName(full), "Inspectra_Compliance_Report_2026-08-08_to_2026-11-06.pdf");
console.log("ok");
