import { useState } from "react";
import { Mail, Printer } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { Establishment, InspectionLog } from "@/lib/models";
import { isoDatePart } from "@/lib/inspectionDates";
import { answerKind } from "@/components/InspectionChecklistView";
import { supabase } from "@/lib/supabase";

// [REF: SANITARY_ORDER_VIEW]
//
// The Sanitary Order (CHO-ESD-FR-04) as the office files it, rendered from one
// inspection log. Laid out to match the controlled paper form field for field,
// so a reader can check the screen against the booklet page without
// translating between them.
//
// There is no PDF library in this project, in either client, and this is why
// it does not need one: the browser's own print dialog has "Save as PDF", and
// `print.css` isolates this subtree so that is all it prints. A PDF
// dependency would have had to be added twice — here and in the mobile app —
// to produce a document the office is going to print anyway.
//
// Read-only on purpose. `firestore.ts` has no saveInspectionLog: logs are
// written by the mobile client at inspection time, and that includes the
// order. Correcting one happens on the phone, not at the desk.

// shortcut: the City Health Officer's name is printed on the controlled form
// itself, so it is a constant here. Move it to a settings row when the office
// next changes officers.
const CITY_HEALTH_OFFICER = "ROSANNA CARMELITA A. BARRION, MD, CFP, MPH, FPSMSG";
const CITY_HEALTH_OFFICER_TITLE = "City Health Officer II";
const FORM_CODE = "CHO-ESD-FR-04";

/** A blank line on the paper form, for a field the record does not carry. */
const BLANK = "—";

/** The address as one printable line.
 *
 *  Three stored shapes, all live: a `{barangay, street}` object on records
 *  written by the current form, that same object as a JSON *string* on
 *  slightly older ones, and a plain free-text address on the oldest. The
 *  modal's edit path (AddEstablishmentModal) copes with the same three; this
 *  is the read-only half of that. */
function addressLine(est: Establishment | null | undefined): string {
  if (!est) return BLANK;
  const raw = est.address;
  let parts: string[] = [];

  if (raw && typeof raw === "object") {
    parts = [raw.street, raw.barangay];
  } else if (typeof raw === "string" && raw.trim() && raw !== "N/A") {
    try {
      const parsed = JSON.parse(raw);
      parts = [parsed?.street, parsed?.barangay];
    } catch {
      parts = [raw];
    }
  }

  // The dedicated barangay column, which is deliberately duplicated out of
  // the address blob, is the fallback when the blob had no barangay in it.
  if (!parts.some((p) => p && p === est.barangay)) parts.push(est.barangay ?? "");

  const line = parts
    .map((p) => (typeof p === "string" ? p.trim() : ""))
    .filter(Boolean)
    .join(", ");
  return line || BLANK;
}

interface SanitaryOrderViewProps {
  log: InspectionLog;
  /** The establishment, when the caller has it. The Name and Address lines of
   *  the form come off this record, not the log — the log denormalises only
   *  the business name. Absent (the Inspections list has no establishment in
   *  hand) those lines print blank, exactly as an unfilled form would. */
  establishment?: Establishment | null;
}

export function SanitaryOrderView({ log, establishment }: SanitaryOrderViewProps) {
  // Local, not refetched: the dialog's log came from a one-shot
  // fetchInspectionDetails, so the stamp this component earns is shown from
  // here rather than by invalidating a query this component does not own.
  const [sentAt, setSentAt] = useState<string | null>(log.email_sent_at ?? null);
  const [sending, setSending] = useState(false);

  const emailCopy = async () => {
    setSending(true);
    // `resend` is sent explicitly rather than defaulted in the function: a
    // legal notice mailed twice with two timestamps invites an argument about
    // which copy counts, so the second send is always a deliberate act.
    const { data, error } = await supabase.functions.invoke("send-sanitary-order", {
      body: { logId: log.id, resend: sentAt != null },
    });
    setSending(false);

    if (error) {
      // On a non-2xx the SDK gives a generic FunctionsHttpError; the real
      // message ("This establishment has no point person email...") is in the
      // response body, and it is the only version worth showing an operator.
      let message = error.message;
      try {
        const body = await (error as { context?: Response }).context?.json();
        if (body?.error) message = body.error;
      } catch {
        // Body wasn't JSON (e.g. a gateway error page) — generic stands.
      }
      toast.error(message);
      return;
    }

    const at = (data as { emailSentAt?: string } | null)?.emailSentAt ?? null;
    setSentAt(at);
    toast.success(
      `Copy emailed to ${(data as { to?: string } | null)?.to ?? "the point person"}.`,
    );
  };

  // The order's own date, falling back to the inspection date: the form shows
  // both and in practice they are the same day — the notice is served on site.
  // isoDatePart renders its own "No Date" for a missing value, so no
  // fallback is wanted here — a second one would be unreachable.
  const issuedDate = isoDatePart(log.so_issued_at ?? log.inspection_date);
  // Derived from `issuedDate`, not sliced off the raw timestamp. The raw value
  // is serialised in UTC, so slicing it printed the UTC year while the line
  // above printed the local date and the database filed the order under the
  // Manila year — an order issued 05:00 on 1 Jan 2027 read
  // "DATE: 2027-01-01" under "NO. 47, S. 2026". isoDatePart yields "No Date"
  // for a missing value, hence the shape test rather than a bare slice.
  const seriesYear = /^\d{4}-/.test(issuedDate) ? issuedDate.slice(0, 4) : "";

  // The left and right columns of the form's table.
  //
  // Filtered by ANSWER, never by "has a note": a note can outlive the Fail
  // that justified it, and printing a withdrawn deficiency here would cite a
  // violation the inspector took back — on a document that tells its reader
  // they are liable for prosecution. Uses the shared answerKind so a legacy
  // 'Non-Compliant' row reads as a fail here the same way it does in the
  // checklist above; the mobile client only writes 'Fail' on anything new
  // enough to carry an order at all.
  const defects = (log.results ?? []).filter((r) => answerKind(r?.answer) === "fail");

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between" data-print-hide>
        <h4 className="font-bold text-slate-900 text-sm">Sanitary Order</h4>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={emailCopy} disabled={sending}>
            <Mail className="w-4 h-4 mr-1.5" />
            {sending ? "Sending…" : sentAt ? "Email copy again" : "Email copy"}
          </Button>
          <Button variant="outline" size="sm" onClick={() => window.print()}>
            <Printer className="w-4 h-4 mr-1.5" />
            Print / Save as PDF
          </Button>
        </div>
      </div>

      {/* The printable subtree. print.css hides everything else on the page
          and lifts this to the top-left of the sheet. */}
      <div
        data-print-root
        className="border border-border rounded-lg p-5 bg-white text-slate-900 text-sm leading-relaxed"
      >
        <div className="flex justify-between text-[10px] text-slate-500 mb-4">
          <span>Code: {FORM_CODE}</span>
          <span>Effectivity Date: January 1, 2024</span>
          <span>Revision No: 01</span>
        </div>

        <div className="flex justify-between text-xs font-medium mb-4">
          <span>DATE: {issuedDate}</span>
          {/* The establishment's control number. The form's header asks for a
              CONTROL NO. and this is the only one the system holds — whether
              CHO means this or a per-order number is still an open question
              with them. */}
          <span>CONTROL NO.: {establishment?.control_no || BLANK}</span>
        </div>

        <div className="text-center mb-5">
          <p className="font-bold tracking-wide">SANITARY ORDER</p>
          {/* A blank number is a blank line, not "null": the number is typed
              off CHO's pre-numbered booklet and is allowed to be absent until
              their numbering pattern is known. */}
          <p className="font-bold">
            NO. {log.so_no || "______"}
            {seriesYear ? `, S. ${seriesYear}` : ""}
          </p>
        </div>

        <div className="space-y-1 mb-4">
          <p>
            <span className="font-semibold">Name:</span>{" "}
            {establishment?.owner_name || BLANK}
          </p>
          <p>
            <span className="font-semibold">Address:</span> {addressLine(establishment)}
          </p>
          <p>
            <span className="font-semibold">Name of Establishment:</span>{" "}
            {establishment?.business_name || log.establishment_name || BLANK}
          </p>
        </div>

        <p className="mb-2">Sir/Madam:</p>
        <p className="mb-4 text-justify">
          An inspection of your premises/establishment was made on{" "}
          <span className="font-semibold">{isoDatePart(log.inspection_date)}</span>{" "}
          and the defects listed on the left column below are observed. Please
          correct defects within the time date hereunder. Corresponding
          correction for each defect/violation is listed in the right column.
        </p>

        <table className="w-full border-collapse border border-slate-400 mb-4">
          <thead>
            <tr>
              <th className="border border-slate-400 p-2 text-left text-xs font-bold w-1/2">
                Sanitary Defect / Violation
              </th>
              <th className="border border-slate-400 p-2 text-left text-xs font-bold w-1/2">
                Recommended Correction / Action
              </th>
            </tr>
          </thead>
          <tbody>
            {defects.length === 0 ? (
              // Unreachable through the mobile form, which refuses to issue an
              // order without at least one defect. Kept because an empty table
              // on a legal notice must read as empty rather than as a missing
              // render.
              <tr>
                <td className="border border-slate-400 p-2 text-slate-500" colSpan={2}>
                  No defects recorded on this order.
                </td>
              </tr>
            ) : (
              defects.map((d, idx) => (
                <tr key={d?.checklist_item_id ?? idx}>
                  <td className="border border-slate-400 p-2 align-top">
                    <span className="font-medium">{d?.item_name || "Checklist item"}</span>
                    {d?.note ? (
                      <>
                        {" — "}
                        <span className="whitespace-pre-wrap">{d.note}</span>
                      </>
                    ) : null}
                  </td>
                  <td className="border border-slate-400 p-2 align-top whitespace-pre-wrap">
                    {d?.correction || BLANK}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        <div className="flex flex-wrap gap-x-8 gap-y-1 text-xs font-medium mb-4">
          <span>TIME GIVEN FOR CORRECTION: {log.time_given || BLANK}</span>
          <span>DEADLINE: {log.deadline || BLANK}</span>
        </div>

        <p className="mb-5 text-justify text-xs">
          A re-inspection of your premises/establishment shall be made after the
          lapse of the time given for correction in order to determine compliance
          with this notice. Non-compliance would be a violation of P.D. 522
          Implementing Rules and Regulations / P.D. 856, City Ordinance No.19,
          s. 2008 and City Ordinance No.16, s.2018, and render you liable for
          prosecution.
        </p>

        <div className="grid grid-cols-2 gap-6 mb-6">
          <div>
            <p className="text-xs font-semibold mb-1">Delivered by:</p>
            {log.signature_url ? (
              <img
                src={log.signature_url}
                alt="Inspector's signature"
                className="h-12 w-auto"
              />
            ) : (
              <div className="h-12" />
            )}
            <p className="border-t border-slate-400 pt-1 text-xs">
              {log.inspector_name || BLANK}
            </p>
          </div>
          <div>
            <p className="text-xs font-semibold mb-1">Received by:</p>
            {/* The acknowledgment that makes the notice served. A missing one
                means the order was recorded but service was not evidenced —
                worth looking plainly blank rather than being tidied away. */}
            {log.received_signature_url ? (
              <img
                src={log.received_signature_url}
                alt="Recipient's signature"
                className="h-12 w-auto"
              />
            ) : (
              <div className="h-12" />
            )}
            <p className="border-t border-slate-400 pt-1 text-xs">
              {log.received_by_name || BLANK}
            </p>
          </div>
        </div>

        <div className="text-right">
          <p className="text-xs font-bold">{CITY_HEALTH_OFFICER}</p>
          <p className="text-xs">{CITY_HEALTH_OFFICER_TITLE}</p>
        </div>
      </div>

      {/* Delivery state, for the office rather than the recipient — so it sits
          outside the printable form. `email_sent_at` is the only delivery
          claim this system can defend: it records that a copy was sent, never
          that anyone read it. The signature above is the service of notice. */}
      <p className="text-xs text-muted-foreground" data-print-hide>
        {sentAt
          ? `A copy was emailed on ${isoDatePart(sentAt)}.`
          : "No copy has been emailed yet."}
      </p>
    </div>
  );
}
