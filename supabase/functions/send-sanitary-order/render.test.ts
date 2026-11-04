import { assertEquals, assertStringIncludes } from "jsr:@std/assert";

import {
  addressLine,
  dayOf,
  defectsOf,
  esc,
  EstablishmentRow,
  OrderRow,
  parseSender,
  renderHtml,
  renderSubject,
} from "./render.ts";

// Run: deno test supabase/functions/send-sanitary-order/
//
// The rules here are the ones whose failure mode is a wrong legal notice in
// somebody's inbox, rather than a wrong number on a dashboard.

const order = (over: Partial<OrderRow> = {}): OrderRow => ({
  id: "log-1",
  so_no: "47",
  so_issued_at: "2026-10-23T02:00:00.000Z",
  inspection_date: "2026-10-23T02:00:00.000Z",
  inspector_name: "Inspector Reyes",
  time_given: "7 days",
  deadline: "2026-10-30",
  received_by_name: "Juan Dela Cruz",
  establishment_name: "Aling Nena Carinderia",
  results: [
    { answer: "Fail", item_name: "Hairnets", note: "None worn", correction: "Provide hairnets" },
    { answer: "Pass", item_name: "Water source", note: "" },
    { answer: "NA", item_name: "Freezer", note: "stale text from a withdrawn fail" },
  ],
  ...over,
});

const est = (over: Partial<EstablishmentRow> = {}): EstablishmentRow => ({
  business_name: "Aling Nena Carinderia",
  owner_name: "Nena Santos",
  barangay: "Alangilan",
  address: { street: "12 Rizal St.", barangay: "Alangilan" },
  control_no: "CN-0099",
  point_person_name: "Juan Dela Cruz",
  point_person_email: "juan@example.com",
  ...over,
});

// [REF: SO_EMAIL_ESCAPE]
Deno.test("esc neutralises markup in inspector free text", () => {
  assertEquals(esc("<b>x</b>"), "&lt;b&gt;x&lt;/b&gt;");
  assertEquals(esc("Tom & Jerry's"), "Tom &amp; Jerry&#39;s");
  assertEquals(esc('say "hi"'), "say &quot;hi&quot;");
  assertEquals(esc(null), "");
  // & first, or the entities produced by the later rules get double-escaped.
  assertEquals(esc("a<b"), "a&lt;b");
});

Deno.test("a defect containing markup cannot inject into the email", () => {
  const html = renderHtml(
    order({
      results: [{
        answer: "Fail",
        item_name: "Pest control",
        note: '<img src=x onerror="alert(1)">',
        correction: "</td></tr><script>bad()</script>",
      }],
    }),
    est(),
  );

  // Nothing the inspector typed may survive as a tag.
  assertEquals(html.includes("<img src=x"), false);
  assertEquals(html.includes("<script>bad()"), false);
  assertStringIncludes(html, "&lt;img src=x");
  assertStringIncludes(html, "&lt;script&gt;bad()");
});

Deno.test("an ampersand in a business name survives as one ampersand", () => {
  // The subject line is not markup. Escaping it would mail a literal "&amp;".
  const subject = renderSubject(order(), est({ business_name: "Tom & Jerry Eatery" }));
  assertStringIncludes(subject, "Tom & Jerry Eatery");
  assertEquals(subject.includes("&amp;"), false);
  // ...while the HTML body, which IS markup, escapes the same name.
  const html = renderHtml(order(), est({ business_name: "Tom & Jerry Eatery" }));
  assertStringIncludes(html, "Tom &amp; Jerry Eatery");
});

Deno.test("defects come from the answer, never from the presence of a note", () => {
  // The N/A row in the fixture carries leftover text from a withdrawn Fail.
  // Mailing it would cite a violation the inspector took back.
  const defects = defectsOf(order().results);
  assertEquals(defects.length, 1);
  assertEquals(defects[0].item, "Hairnets");
});

Deno.test("the pre-2025 'Non-Compliant' spelling still counts as a defect", () => {
  const defects = defectsOf([{ answer: "Non-Compliant", item_name: "Old row" }]);
  assertEquals(defects.length, 1);
});

Deno.test("missing results degrade to an empty table rather than throwing", () => {
  assertEquals(defectsOf(null).length, 0);
  const html = renderHtml(order({ results: null }), est());
  assertStringIncludes(html, "No defects recorded.");
});

// [REF: SO_EMAIL_DATE_ZONE]
Deno.test("dayOf reads the Manila day, not the UTC one", () => {
  // The bug this pins: PostgREST serialises timestamptz in UTC, so slicing the
  // first ten characters read a UTC date. 05:00 on 1 Jan 2027 in Batangas City
  // is 21:00 on 31 Dec 2026 UTC — the slice printed the previous year's date
  // under the current year's order number, and disagreed with the database's
  // own series index (which uses `at time zone 'Asia/Manila'`).
  assertEquals(dayOf("2026-12-31T21:00:00+00:00"), "2027-01-01");
  assertEquals(dayOf("2026-10-23T16:30:00+00:00"), "2026-10-24");
  // An offset already in the string is respected the same way.
  assertEquals(dayOf("2026-10-23T23:30:00.000+08:00"), "2026-10-23");
  // A date-only value is a calendar day with no instant behind it, so it must
  // pass through: converting it is what would move it.
  assertEquals(dayOf("2026-10-30"), "2026-10-30");
  assertEquals(dayOf(null), "");
  assertEquals(dayOf("not a date"), "");
});

Deno.test("the printed series year agrees with the printed date", () => {
  const html = renderHtml(
    order({ so_issued_at: "2026-12-31T21:00:00+00:00", so_no: "47" }),
    est(),
  );
  // Both must say 2027; the first version said "DATE: 2027-01-01" under
  // "NO. 47, S. 2026".
  assertStringIncludes(html, "DATE: 2027-01-01");
  assertStringIncludes(html, "S. 2027");
});

Deno.test("the deadline is printed exactly as stored", () => {
  const html = renderHtml(order({ deadline: "2026-10-30" }), est());
  assertStringIncludes(html, "DEADLINE: 2026-10-30");
});

Deno.test("addressLine handles all three stored shapes", () => {
  assertEquals(addressLine(est()), "12 Rizal St., Alangilan");
  assertEquals(
    addressLine(est({ address: '{"street":"9 Mabini","barangay":"Poblacion"}', barangay: "Poblacion" })),
    "9 Mabini, Poblacion",
  );
  assertEquals(
    addressLine(est({ address: "Beside the public market", barangay: "Kumintang" })),
    "Beside the public market, Kumintang",
  );
  // "N/A" is a legacy placeholder, not an address.
  assertEquals(addressLine(est({ address: "N/A", barangay: "Alangilan" })), "Alangilan");
});

Deno.test("an unnumbered order prints a blank line, not 'null'", () => {
  const html = renderHtml(order({ so_no: null }), est());
  assertStringIncludes(html, "NO. ______");
  assertEquals(html.includes("null"), false);
});

Deno.test("the body carries no signature image URLs", () => {
  // Stored signature URLs are ten-year capability URLs. Mailing one outside
  // the organisation hands over a permanent link to a government officer's
  // signature image; the signed acknowledgment the recipient already holds is
  // the evidence of service.
  const html = renderHtml(order(), est());
  assertEquals(html.includes("<img"), false);
  assertEquals(html.includes("signatures/"), false);
});

Deno.test("the notice keeps the statutes the paper form cites", () => {
  // Whitespace-collapsed before matching: the citation wraps across source
  // lines (HTML collapses it on render anyway), so asserting on the raw markup
  // would fail on a reformat while still missing a real deletion. What has to
  // hold is the TEXT a recipient reads.
  const text = renderHtml(order(), est()).replace(/\s+/g, " ");
  for (
    const cite of [
      "P.D. 522",
      "P.D. 856",
      "City Ordinance No.19, s. 2008",
      "City Ordinance No.16, s.2018",
      "liable for prosecution",
      "CHO-ESD-FR-04",
    ]
  ) {
    assertStringIncludes(text, cite);
  }
});

// A wrong sender here is a Sanitary Order that never leaves Brevo, or one that
// arrives from a nameless address.
Deno.test("parseSender splits the configured From", () => {
  assertEquals(parseSender("City Health Office <no-reply@batangascity.gov.ph>"), {
    name: "City Health Office",
    email: "no-reply@batangascity.gov.ph",
  });
  // Quoted display name, as some operators write it.
  assertEquals(parseSender('"City Health Office" <no-reply@example.gov.ph>').name,
    "City Health Office");
  // Bare address: no display name, and the address must not keep the padding.
  assertEquals(parseSender("  no-reply@example.gov.ph  "), {
    name: "",
    email: "no-reply@example.gov.ph",
  });
  // Nonsense is handed back for the caller's "@" check to refuse, not guessed at.
  assertEquals(parseSender("City Health Office").email, "City Health Office");
});
