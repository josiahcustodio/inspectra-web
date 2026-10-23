// [REF: SO_EMAIL_RENDER]
//
// The Sanitary Order as an HTML email body. Pure and separate from index.ts for
// the same reason aggregate.ts is: this is the part with rules worth testing,
// and `deno test` can reach it without a network or a database.
//
// HTML, not a PDF attachment. There is no PDF library anywhere in this project
// — not in the web app, not in the Flutter client — and this is the reason none
// is needed: the recipient reads the order in their mail client and prints it
// from there if they want paper. Adding a PDF dependency server-side is a
// one-function change if CHO ever requires a filed digital original.
//
// shortcut: emailed copy is an HTML body, not a PDF attachment. Upgrade the
// send in index.ts if CHO requires a filed digital original.

export interface OrderRow {
  id: string;
  so_no: string | null;
  so_issued_at: string | null;
  inspection_date: string | null;
  inspector_name: string | null;
  time_given: string | null;
  deadline: string | null;
  received_by_name: string | null;
  establishment_name: string | null;
  results: unknown[] | null;
}

export interface EstablishmentRow {
  business_name: string | null;
  owner_name: string | null;
  barangay: string | null;
  address: unknown;
  control_no: string | null;
  point_person_name: string | null;
  point_person_email: string | null;
}

const CITY_HEALTH_OFFICER = "ROSANNA CARMELITA A. BARRION, MD, CFP, MPH, FPSMSG";
const CITY_HEALTH_OFFICER_TITLE = "City Health Officer II";
const BLANK = "&mdash;";

// [REF: SO_EMAIL_ESCAPE]
/** Escapes text for HTML. Not optional and not defensive paranoia: every
 *  defect description and correction in this document is free text an
 *  inspector typed on a phone, and it is being interpolated into markup that
 *  gets mailed outside the organisation. Unescaped, a stray `<` silently eats
 *  the rest of a violation line — and a deliberate `<a>` or `<img>` would make
 *  this office's own notice carry someone else's content.
 *
 *  Single and double quotes included: attribute interpolation is one careless
 *  edit away even though nothing below does it today. */
export function esc(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

// [REF: SO_EMAIL_DATE_ZONE]
/** The calendar day of a stored timestamp, read in Batangas City.
 *
 *  The first version sliced the first ten characters, on the reasoning that
 *  going through a Date would re-project the instant through UTC. The slice
 *  did something worse: PostgREST serialises a timestamptz in UTC, so it WAS
 *  reading a UTC date. An order issued 05:00 on 1 January in Manila is 21:00
 *  on 31 December UTC, so the emailed notice printed the previous year's date
 *  under the current year's order number — and the database files that order
 *  under `date_part('year', so_issued_at at time zone 'Asia/Manila')`, so the
 *  printed copy and the index disagreed about which series it belonged to.
 *
 *  So the zone is named explicitly. `en-CA` is the locale that formats as
 *  YYYY-MM-DD.
 *
 *  A date-only string passes straight through: `deadline` is already a
 *  calendar day with no instant behind it, and feeding it to a timezone
 *  conversion is what would move it. */
const MANILA = "Asia/Manila";
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export function dayOf(iso: string | null): string {
  if (!iso) return "";
  if (DATE_ONLY.test(iso)) return iso;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: MANILA,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

/** One printable address line out of the three shapes this column holds: a
 *  `{barangay, street}` object, that object as a JSON string, or plain text. */
export function addressLine(est: EstablishmentRow): string {
  const raw = est.address;
  let parts: unknown[] = [];

  if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    parts = [o.street, o.barangay];
  } else if (typeof raw === "string" && raw.trim() && raw !== "N/A") {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      parts = [parsed?.street, parsed?.barangay];
    } catch {
      parts = [raw];
    }
  }
  if (!parts.some((p) => typeof p === "string" && p === est.barangay)) {
    parts.push(est.barangay);
  }

  const line = parts
    .map((p) => (typeof p === "string" ? p.trim() : ""))
    .filter(Boolean)
    .join(", ");
  return line;
}

/** The order's defect table rows.
 *
 *  Selected by ANSWER and never by "has a note". A note can outlive the Fail
 *  that justified it, and mailing a withdrawn deficiency as a cited violation
 *  — on a notice that says the recipient is liable for prosecution — is the
 *  failure this rule exists to prevent. Mirrors SanitaryOrder.defectsFrom in
 *  the Flutter client, which is the authority on what a defect is. */
export function defectsOf(results: unknown[] | null): Array<{
  item: string;
  defect: string;
  correction: string;
}> {
  return (results ?? [])
    .map((r) => (r ?? {}) as Record<string, unknown>)
    .filter((r) => {
      const a = String(r.answer ?? "").toLowerCase();
      // 'non-compliant' is the pre-2025 spelling, carried for parity with the
      // web app's answerKind. Nothing old enough to use it can carry an order.
      return a === "fail" || a === "non-compliant";
    })
    .map((r) => ({
      item: String(r.item_name ?? ""),
      defect: String(r.note ?? "").trim(),
      correction: String(r.correction ?? "").trim(),
    }));
}

export function renderSubject(order: OrderRow, est: EstablishmentRow): string {
  const name = est.business_name || order.establishment_name || "your establishment";
  const no = order.so_no ? `No. ${order.so_no}` : "";
  // No escaping here: a subject line is not markup. Escaping it would mail a
  // literal "&amp;" to anyone whose business name contains an ampersand.
  return `Sanitary Order ${no} — ${name}`.replace(/\s+/g, " ").trim();
}

export function renderHtml(order: OrderRow, est: EstablishmentRow): string {
  const defects = defectsOf(order.results);
  // Derived from the Manila date above, so the printed series year cannot
  // disagree with the printed date or with the database's unique index.
  const seriesYear = dayOf(order.so_issued_at ?? order.inspection_date).slice(0, 4);

  const rows = defects.length === 0
    // Unreachable through the mobile form, which will not issue an order
    // without a defect. An empty table must still read as empty rather than
    // as a template that failed to fill.
    ? `<tr><td colspan="2" style="border:1px solid #888;padding:8px;color:#666">No defects recorded.</td></tr>`
    : defects
      .map((d) => `
        <tr>
          <td style="border:1px solid #888;padding:8px;vertical-align:top">
            <strong>${esc(d.item)}</strong>${d.defect ? ` &mdash; ${esc(d.defect)}` : ""}
          </td>
          <td style="border:1px solid #888;padding:8px;vertical-align:top">
            ${d.correction ? esc(d.correction) : BLANK}
          </td>
        </tr>`)
      .join("");

  const address = addressLine(est);

  // Inline styles throughout: email clients strip <style> blocks and none of
  // them support a stylesheet. Signature images are deliberately NOT embedded
  // — the stored URLs are ten-year capability URLs, and mailing one outside
  // the organisation hands over a permanent link to a government officer's
  // signature image. The signed acknowledgment the recipient already holds is
  // the evidence of service; this is a reference copy.
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#000;max-width:720px">
  <div style="font-size:10px;color:#666;margin-bottom:16px">
    Code: CHO-ESD-FR-04 &middot; Effectivity Date: January 1, 2024 &middot; Revision No: 01
  </div>

  <div style="font-size:12px;margin-bottom:16px">
    <div>DATE: ${esc(dayOf(order.so_issued_at ?? order.inspection_date)) || BLANK}</div>
    <div>CONTROL NO.: ${esc(est.control_no) || BLANK}</div>
  </div>

  <div style="text-align:center;margin-bottom:20px">
    <div style="font-weight:bold;letter-spacing:1px">SANITARY ORDER</div>
    <div style="font-weight:bold">
      NO. ${order.so_no ? esc(order.so_no) : "______"}${seriesYear ? `, S. ${esc(seriesYear)}` : ""}
    </div>
  </div>

  <div style="margin-bottom:16px;line-height:1.6">
    <div><strong>Name:</strong> ${esc(est.owner_name) || BLANK}</div>
    <div><strong>Address:</strong> ${esc(address) || BLANK}</div>
    <div><strong>Name of Establishment:</strong> ${
    esc(est.business_name || order.establishment_name) || BLANK
  }</div>
  </div>

  <p>Sir/Madam:</p>
  <p style="text-align:justify;line-height:1.6">
    An inspection of your premises/establishment was made on
    <strong>${esc(dayOf(order.inspection_date)) || BLANK}</strong>
    and the defects listed on the left column below are observed. Please correct
    defects within the time date hereunder. Corresponding correction for each
    defect/violation is listed in the right column.
  </p>

  <table style="width:100%;border-collapse:collapse;margin:16px 0">
    <thead>
      <tr>
        <th style="border:1px solid #888;padding:8px;text-align:left;width:50%">Sanitary Defect / Violation</th>
        <th style="border:1px solid #888;padding:8px;text-align:left;width:50%">Recommended Correction / Action</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>

  <div style="font-size:12px;font-weight:bold;margin-bottom:16px">
    <div>TIME GIVEN FOR CORRECTION: ${esc(order.time_given) || BLANK}</div>
    <div>DEADLINE: ${esc(order.deadline) || BLANK}</div>
  </div>

  <p style="text-align:justify;font-size:12px;line-height:1.6">
    A re-inspection of your premises/establishment shall be made after the lapse
    of the time given for correction in order to determine compliance with this
    notice. Non-compliance would be a violation of P.D. 522 Implementing Rules
    and Regulations / P.D. 856, City Ordinance No.19, s. 2008 and City Ordinance
    No.16, s.2018, and render you liable for prosecution.
  </p>

  <div style="font-size:12px;margin:20px 0">
    <div>Delivered by: ${esc(order.inspector_name) || BLANK}</div>
    <div>Received by: ${esc(order.received_by_name) || BLANK}</div>
  </div>

  <div style="text-align:right;font-size:12px">
    <div style="font-weight:bold">${CITY_HEALTH_OFFICER}</div>
    <div>${CITY_HEALTH_OFFICER_TITLE}</div>
  </div>

  <p style="font-size:11px;color:#666;margin-top:24px;border-top:1px solid #ddd;padding-top:12px">
    This is a reference copy of the Sanitary Order served to you and signed for
    at the time of inspection. The signed original is on file with the City
    Health Office. Please do not reply to this message.
  </p>
</div>`;
}
