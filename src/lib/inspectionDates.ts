// [REF: INSPECTION_DATE_CONVENTION]
//
// One place for reading the timestamps on these records, because there are two
// kinds of them in Firestore and they must NOT be read the same way.
//
//   * Zone-less wall clock — "2026-09-28T13:05:00.000". What the Flutter client
//     writes for `inspection_date`, via DateTime.now().toIso8601String(). There
//     is no instant in this value, only the calendar day and clock time someone
//     wrote down. Parsing it and re-formatting it can move it onto a different
//     day, so its parts are taken by slicing the string.
//
//   * A true instant — "2026-09-28T23:00:00.000Z". What new Date().toISOString()
//     writes for `created_at`. This one carries a zone and MUST be converted:
//     slicing it would show an establishment registered at 07:00 in UTC+8 as the
//     previous day.
//
// Applying either rule to both kinds is how a date column silently goes off by
// one, so the kind is detected from the value itself and every screen that shows
// one of these dates goes through here. That is what stops two panes of the same
// modal disagreeing about which day an inspection was.

/** True when the timestamp names an instant rather than a bare wall clock. */
function hasZoneDesignator(iso: string): boolean {
  const time = iso.split("T")[1];
  if (!time) return false;
  return /(?:Z|[+-]\d{2}:?\d{2})$/.test(time);
}

interface LocalParts {
  year: number;
  month: number; // 1-12
  day: number;
  hours: number;
  minutes: number;
  hasTime: boolean;
}

// The calendar day and clock time the value denotes for the reader: sliced
// verbatim when it is already local wall clock, converted through Date when it
// carries a zone. Returns null rather than an Invalid Date that spreads silently.
function localParts(iso: string | null | undefined): LocalParts | null {
  if (!iso) return null;

  // The declared type says string, but these values come straight off
  // Firestore documents that other clients and console edits can shape —
  // a Timestamp object or a number here would make .split throw and take
  // down the whole table render for one malformed record. Treat anything
  // that isn't a string as "no date".
  if (typeof iso !== "string") return null;

  if (hasZoneDesignator(iso)) {
    const at = new Date(iso);
    if (Number.isNaN(at.getTime())) return null;
    return {
      year: at.getFullYear(),
      month: at.getMonth() + 1,
      day: at.getDate(),
      hours: at.getHours(),
      minutes: at.getMinutes(),
      hasTime: true,
    };
  }

  const [datePortion, timePortion] = iso.split("T");
  const [year, month, day] = datePortion.split("-").map(Number);
  if (!year || !month || !day) return null;
  const [hours, minutes] = (timePortion ?? "").split(":").map(Number);
  return {
    year,
    month,
    day,
    hours: Number.isFinite(hours) ? hours : 0,
    minutes: Number.isFinite(minutes) ? minutes : 0,
    hasTime: Boolean(timePortion),
  };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** The `YYYY-MM-DD` day the value denotes locally, or "No Date" when absent. */
export function isoDatePart(iso: string | null | undefined): string {
  const parts = localParts(iso);
  if (!parts) return "No Date";
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

/** The `HH:MM` clock time, or "" when the value carries no time at all. */
export function isoTimePart(iso: string | null | undefined): string {
  const parts = localParts(iso);
  if (!parts || !parts.hasTime) return "";
  return `${pad(parts.hours)}:${pad(parts.minutes)}`;
}

/** The denoted calendar day as a local-midnight Date, for day arithmetic. */
export function calendarDayOf(iso: string | null | undefined): Date | null {
  const parts = localParts(iso);
  if (!parts) return null;
  return new Date(parts.year, parts.month - 1, parts.day);
}

/**
 * A stored date as "Sep 28, 2026", in the reader's locale. Absent or
 * unparseable values read "No date" rather than "Invalid Date".
 */
export function formatShortDate(iso: string | null | undefined): string {
  const day = calendarDayOf(iso);
  if (!day) return "No date";
  return day.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

// Newest first. Dates are ISO-8601 strings, so plain string comparison sorts
// chronologically; records with no date sink to the bottom rather than being
// guessed into an order.
export function byNewestFirst(
  a: { inspection_date: string | null },
  b: { inspection_date: string | null },
): number {
  if (!a.inspection_date) return b.inspection_date ? 1 : 0;
  if (!b.inspection_date) return -1;
  return b.inspection_date.localeCompare(a.inspection_date);
}


// How long ago an inspection happened, in the granularity that actually matters
// for one: days, not minutes. An inspection is a dated event, so "Yesterday" is
// the useful answer and "3 hours ago" is noise.
//
// `absentLabel` exists because the honest wording depends on the caller. The GIS
// map lists establishments that may never have been inspected at all, so it says
// "Never inspected"; the history modal only ever renders rows that already have a
// log, so a missing date there is bad data and a dash is the honest answer.
export function relativeInspectionAge(
  iso: string | null | undefined,
  absentLabel = "\u2014",
): string {
  if (!iso) return absentLabel;

  // calendarDayOf, not `new Date(iso)` — it applies the right rule for a
  // zone-less wall clock versus a UTC instant. See the header of this file.
  const then = calendarDayOf(iso);

  // A stored value that will not parse is corrupt data, which is a different
  // thing from no value at all: "Never inspected" would be a claim about the
  // establishment rather than about the record. Defer to formatShortDate, whose
  // own unparseable answer is "No date".
  if (!then) return formatShortDate(iso);

  const midnightOf = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  const days = Math.round((midnightOf(new Date()) - midnightOf(then)) / 86_400_000);

  // A record dated in the future is bad data, not a schedule. Falling back to the
  // plain date keeps "in 5 days" from ever appearing under a "Last inspected"
  // label, which would assert something that has not happened.
  if (days < 0) return formatShortDate(iso);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 30) {
    const weeks = Math.floor(days / 7);
    return `${weeks} week${weeks === 1 ? "" : "s"} ago`;
  }
  if (days < 365) {
    const months = Math.floor(days / 30);
    return `${months} month${months === 1 ? "" : "s"} ago`;
  }
  const years = Math.floor(days / 365);
  return `${years} year${years === 1 ? "" : "s"} ago`;
}
