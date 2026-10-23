// Run with:  deno test supabase/functions/generate-barangay-summary/aggregate.test.ts
//
// Guards the three copied normalisation rules (bands, answer kinds, barangay
// fallback) — the ones that silently drift when ratingScale.ts or the mobile
// client changes and nobody remembers this function has its own copy.

import { assertEquals } from "jsr:@std/assert";
import { aggregate, bandOf, barangayOf, isFailedAnswer } from "./aggregate.ts";

Deno.test("band thresholds mirror ratingScale.ts (90 / 70, inclusive)", () => {
  assertEquals(bandOf(90), "excellent");
  assertEquals(bandOf(89), "very_satisfactory");
  assertEquals(bandOf(70), "very_satisfactory");
  assertEquals(bandOf(69), "satisfactory"); // lowest band, despite the name
});

Deno.test("failed answers cover both the mobile and legacy spellings", () => {
  assertEquals(isFailedAnswer("Fail"), true);
  assertEquals(isFailedAnswer("Non-Compliant"), true);
  assertEquals(isFailedAnswer("Pass"), false);
  assertEquals(isFailedAnswer("NA"), false);
  assertEquals(isFailedAnswer(null), false);
});

Deno.test("barangay fallback: column, then string address, then address.barangay", () => {
  assertEquals(barangayOf({ id: "1", business_name: "", barangay: "Alangilan", address: null }), "Alangilan");
  assertEquals(barangayOf({ id: "2", business_name: "", barangay: null, address: "Kumintang Ibaba" }), "Kumintang Ibaba");
  assertEquals(barangayOf({ id: "3", business_name: "", barangay: null, address: { barangay: "Pallocan West" } }), "Pallocan West");
  assertEquals(barangayOf({ id: "4", business_name: "", barangay: null, address: null }), null);
});

Deno.test("aggregate counts, averages, violations and the Unknown bucket", () => {
  const establishments = [
    { id: "e1", business_name: "Bakery A", barangay: "Alangilan", address: null },
    { id: "e2", business_name: "Cafe B", barangay: "Alangilan", address: null },
  ];
  const logs = [
    {
      establishment_id: "e1", establishment_name: "Bakery A",
      percentage_rating: 95, remarks: "Clean premises.", inspection_date: "2026-09-01",
      results: [{ item_name: "Waste segregation", answer: "Fail", note: "Mixed bins" }],
    },
    {
      establishment_id: "e2", establishment_name: "Cafe B",
      percentage_rating: 65, remarks: null, inspection_date: "2026-09-02",
      results: [
        { item_name: "Waste segregation", answer: "Non-Compliant" },
        { item_name: "Handwashing station", answer: "Pass" },
      ],
    },
    // No establishment → must land in "Unknown", not disappear.
    {
      establishment_id: null, establishment_name: null,
      percentage_rating: null, remarks: null, inspection_date: null, results: null,
    },
  ];

  const out = aggregate(logs, establishments);
  assertEquals(out.length, 2);

  const alangilan = out.find((b) => b.name === "Alangilan")!;
  assertEquals(alangilan.inspections, 2);
  assertEquals(alangilan.establishments_inspected, 2);
  assertEquals(alangilan.average_rating, 80); // (95 + 65) / 2
  assertEquals(alangilan.bands, { excellent: 1, very_satisfactory: 0, satisfactory: 1, unscored: 0 });
  assertEquals(alangilan.top_failed_items, [{ item: "Waste segregation", failures: 2 }]);
  assertEquals(alangilan.lowest_rated[0], { establishment: "Cafe B", rating: 65 });

  const unknown = out.find((b) => b.name === "Unknown")!;
  assertEquals(unknown.inspections, 1);
  assertEquals(unknown.bands.unscored, 1);
  assertEquals(unknown.average_rating, null);
});
