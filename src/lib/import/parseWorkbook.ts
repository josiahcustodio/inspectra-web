// [REF: MASTERLIST_PARSE]
//
// Turns an uploaded masterlist .xlsx into clean rows, one sheet at a time.
//
// The real workbooks (verified against the 2026 Batangas City food and
// non-food masterlists) are hand-maintained and messy in very specific ways,
// and every rule in this file exists because of something actually observed
// in them:
//
//   - One sheet per category; the sheet name IS the category ("Bakery",
//     "Eatery", "SariSariStoreA"). Category mapping is the admin's call on
//     the preview screen, not something this parser guesses.
//   - The header row floats: row 1 on some sheets, row 2 or 3 on others
//     (below banner rows like "MASTERLIST OF CANTEEN - BATANGAS CITY 2026"),
//     and a few sheets have no header row at all.
//   - Column names vary between sheets for the same field: "DATE INSPECTED"
//     vs "Date of Inspection", "SSSR" vs "SSS Rating".
//   - "Business Address" is a merged header spanning two columns — the
//     street address, then an unnamed column holding the barangay.
//   - Sheets with no header follow the 20-column BPLO export layout
//     (permit no in col 3, TWO dates, a TIN in col 6).
//   - A "Permit No." cell is not always a permit number: "N/A", "-" and
//     "pending" all occur. Those parse as null, never as a permit — a
//     placeholder shared by unrelated rows must not become the identity the
//     matcher merges them on. (The cell text stays in the row's `raw`; see
//     MasterlistRow.raw for when that is persisted.)
//
// This module is pure: no Firestore, no React — it takes bytes and returns
// data, so it can be exercised directly against the sample workbooks.

import * as XLSX from "xlsx";
import { normText, toYmd } from "./normalize";

/** One business, as parsed from one Excel row. All fields nullable because
 *  every one of them is genuinely sometimes blank in the real files. */
export interface MasterlistRow {
  sheetName: string;
  /** 1-based row number in the sheet, for error messages the admin can
   *  actually follow back to Excel. */
  rowNumber: number;

  applic_type: string | null;
  business_permit_no: string | null;
  permit_date_issued: string | null; // "YYYY-MM-DD"
  business_name: string | null;
  line_of_business: string | null;
  floor_area_sqm: number | null;
  personnel_count: number | null;
  address: string | null;
  barangay: string | null;
  owner_name: string | null;
  tel_no: string | null;
  tin: string | null;

  // Legacy inspection columns from the spreadsheet era. Stored on the permit
  // record for reference only — the live DATE INSPECTED / REMARKS shown in
  // the dashboard always come from inspection_logs, never from these.
  import_date_inspected: string | null;
  import_sssr: string | null;
  import_remarks: string | null;

  /** The original cells, stringified. Persisted verbatim on the permit record
   *  and on review items (runImport's rowForStorage), so those import decisions
   *  can be audited later. A row with no valid permit number writes no permit
   *  record, so for a create/renewal decision on such a row these cells are
   *  NOT stored anywhere — `raw` is in-memory only until something persists it. */
  raw: (string | number | null)[];
}

export interface SkippedRow {
  rowNumber: number;
  reason: string;
  /** First few non-empty cells, so the admin can recognise the row. */
  preview: string;
}

export type SheetLayout = "header" | "bplo-positional" | "unrecognized";

export interface SheetParse {
  sheetName: string;
  layout: SheetLayout;
  /** Which 1-based row the header was found on (header layout only). */
  headerRowNumber: number | null;
  rows: MasterlistRow[];
  skipped: SkippedRow[];
  /** Set for unrecognized sheets: why we could not parse them. */
  problem: string | null;
}

export interface WorkbookParse {
  sheets: SheetParse[];
  totalRows: number;
}

type Cell = string | number | boolean | Date | null;

// ─── Header recognition ─────────────────────────────────────────────────────

// Every header spelling observed across the 59 sheets of the two sample
// workbooks, normalised through normText. Unknown headers are ignored (their
// cells still survive inside `raw`).
const HEADER_ALIASES: Record<string, keyof MasterlistRow | "ignore"> = {
  "no": "ignore",
  "applic type": "applic_type",
  "application type": "applic_type",
  "permit no": "business_permit_no",
  "permit number": "business_permit_no",
  "date issued": "permit_date_issued",
  "business trade name": "business_name",
  "business name": "business_name",
  "trade name": "business_name",
  "line kind of business": "line_of_business",
  "line of business": "line_of_business",
  "kind of business": "line_of_business",
  "nature of business": "line_of_business",
  "flr area sqm": "floor_area_sqm",
  "flr area": "floor_area_sqm",
  "floor area sqm": "floor_area_sqm",
  "floor area": "floor_area_sqm",
  "no of employee": "personnel_count",
  "no of employees": "personnel_count",
  "business address": "address",
  "address": "address",
  "barangay": "barangay",
  "owner s name": "owner_name",
  "owners name": "owner_name",
  "owner name": "owner_name",
  "tel no": "tel_no",
  "telephone no": "tel_no",
  "contact no": "tel_no",
  "tin": "tin",
  "date inspected": "import_date_inspected",
  "date of inspection": "import_date_inspected",
  "sssr": "import_sssr",
  "sss rating": "import_sssr",
  "remarks": "import_remarks",
  // A few sheets have a "Signature" column where SSSR usually sits — it held
  // wet-ink signatures on the printed copy, so there is nothing to import.
  "signature": "ignore",
};

/** Looks like a permit number: 1-3 letters, optional dash, 3+ digits
 *  ("F-261174", "NF 08123"). The anchor the header/row detectors key on, and
 *  the gate on the Permit No. column itself: a cell that does not match is
 *  stored as null (its text stays in `raw`; see MasterlistRow.raw for where
 *  that goes), so a placeholder like "N/A" can never become an identity that
 *  two unrelated rows share. Any real permit format outside this pattern is
 *  nulled the same way — silently, as far as the admin can see. */
const PERMIT_NO_PATTERN = /^[a-z]{1,3}\s?-?\s?\d{3,}$/i;

/** Looks like a TIN once punctuation is stripped: 9+ digits. */
const TIN_PATTERN = /^\d{9,}$/;

// ─── Entry point ────────────────────────────────────────────────────────────

export function parseMasterlistWorkbook(data: ArrayBuffer): WorkbookParse {
  // cellDates so date cells arrive as Date objects instead of Excel's
  // serial-number epoch counts.
  const workbook = XLSX.read(data, { cellDates: true });

  const sheets = workbook.SheetNames.map((sheetName) => {
    const worksheet = workbook.Sheets[sheetName];
    const grid: Cell[][] = XLSX.utils.sheet_to_json(worksheet, {
      header: 1,
      defval: null,
      raw: true,
    });
    return parseSheet(sheetName, grid);
  });

  return {
    sheets,
    totalRows: sheets.reduce((sum, s) => sum + s.rows.length, 0),
  };
}

// ─── Per-sheet parsing ──────────────────────────────────────────────────────

function parseSheet(sheetName: string, grid: Cell[][]): SheetParse {
  // [REF: MASTERLIST_HEADER_DETECT]
  // The header row is FOUND, never assumed: scan the first six rows for a
  // cell that normalises to "permit no". Six is generous — the deepest
  // observed header sits on row 3, under a title banner and a date-range row.
  for (let r = 0; r < Math.min(6, grid.length); r++) {
    const headerCells = grid[r];
    if (headerCells.some((c) => typeof c === "string" && HEADER_ALIASES[normText(c)] === "business_permit_no")) {
      const columnMap = buildColumnMap(headerCells);
      return parseDataRows(sheetName, grid, r + 1, columnMap, "header", r + 1);
    }
  }

  // No header row anywhere. The headerless sheets in the sample workbooks all
  // follow the 20-column BPLO export layout; accept that only if a real data
  // row proves it (permit number in col 3, a date in col 4, a TIN in col 6).
  const bploMap = detectBploLayout(grid);
  if (bploMap) {
    return parseDataRows(sheetName, grid, 0, bploMap, "bplo-positional", null);
  }

  return {
    sheetName,
    layout: "unrecognized",
    headerRowNumber: null,
    rows: [],
    skipped: [],
    problem:
      "No header row with a 'Permit No.' column was found, and the rows don't " +
      "match the known headerless (BPLO) layout. This sheet needs to be " +
      "imported manually or fixed in Excel first.",
  };
}

/** Column index -> canonical field, built from a detected header row. */
type ColumnMap = Map<number, keyof MasterlistRow>;

function buildColumnMap(headerCells: Cell[]): ColumnMap {
  const map: ColumnMap = new Map();
  for (let i = 0; i < headerCells.length; i++) {
    const cell = headerCells[i];
    if (typeof cell !== "string") continue;
    const field = HEADER_ALIASES[normText(cell)];
    if (field && field !== "ignore") map.set(i, field);
  }

  // The merged-header rule: "Business Address" spans two columns in these
  // workbooks — the named one holds the street address and the unnamed one
  // right after it holds the barangay. If that next column has no header of
  // its own, claim it.
  for (const [index, field] of map) {
    if (field === "address" && !map.has(index + 1)) {
      const nextHeader = headerCells[index + 1];
      const isUnnamed = nextHeader == null || (typeof nextHeader === "string" && normText(nextHeader) === "");
      if (isUnnamed) map.set(index + 1, "barangay");
      break;
    }
  }
  return map;
}

/** The 20-column BPLO export layout, by position. Only used when a data row
 *  validates against its three strongest signals; columns we have no use for
 *  (validity date, ownership type, capitalisation, fees) stay in `raw`. */
function detectBploLayout(grid: Cell[][]): ColumnMap | null {
  const proof = grid
    .slice(0, 10)
    .find((row) => isPermitNo(row[2]) && row[3] instanceof Date && isTin(row[5]));
  if (!proof) return null;

  return new Map<number, keyof MasterlistRow>([
    [1, "applic_type"],
    [2, "business_permit_no"],
    [3, "permit_date_issued"],
    [5, "tin"],
    [7, "business_name"],
    [8, "line_of_business"],
    [9, "floor_area_sqm"],
    [10, "personnel_count"],
    [11, "address"],
    [12, "owner_name"],
    [13, "tel_no"],
  ]);
}

function isPermitNo(cell: Cell): boolean {
  return typeof cell === "string" && PERMIT_NO_PATTERN.test(cell.trim());
}

function isTin(cell: Cell): boolean {
  return typeof cell === "string" && TIN_PATTERN.test(cell.replace(/\D+/g, ""));
}

// ─── Row conversion ─────────────────────────────────────────────────────────

function parseDataRows(
  sheetName: string,
  grid: Cell[][],
  firstDataIndex: number,
  columnMap: ColumnMap,
  layout: SheetLayout,
  headerRowNumber: number | null,
): SheetParse {
  const rows: MasterlistRow[] = [];
  const skipped: SkippedRow[] = [];

  for (let r = firstDataIndex; r < grid.length; r++) {
    const cells = grid[r];
    const rowNumber = r + 1;
    const nonEmpty = cells.filter((c) => c !== null && c !== "");

    // Blank rows and banner rows ("MASTERLIST OF ...", "January 1, 2026 -
    // March 27, 2026") have at most a cell or two of content. Skipping them
    // silently would hide real single-cell data mistakes, so they are
    // recorded, just without drama.
    if (nonEmpty.length === 0) continue;
    if (nonEmpty.length <= 2 && !cells.some(isPermitNo)) {
      skipped.push({ rowNumber, reason: "Blank or title row", preview: previewOf(cells) });
      continue;
    }

    // Some sheets repeat their header row mid-sheet after a page break.
    // Same alias test as header DETECTION above — testing only the literal
    // spelling "permit no" here would let a repeated "PERMIT NUMBER" header
    // slip through and import as a fake establishment named
    // "BUSINESS TRADE NAME".
    if (cells.some((c) => typeof c === "string" && HEADER_ALIASES[normText(c)] === "business_permit_no")) {
      skipped.push({ rowNumber, reason: "Repeated header row", preview: previewOf(cells) });
      continue;
    }

    const row = emptyRow(sheetName, rowNumber);
    for (const [index, field] of columnMap) {
      assignCell(row, field, cells[index]);
    }
    row.raw = cells.map(serializeCell);

    // A row counts as real data only if it names a business AND either
    // carries a valid permit number (assignCell has already nulled anything
    // that is not one) or has at least two other usable fields. A permit
    // number with no name is not importable: it would create an establishment
    // called "" that nothing can ever match by name. Anything weaker goes to
    // the skipped list for the admin to eyeball.
    const usableFields = [
      row.applic_type, row.permit_date_issued, row.line_of_business,
      row.floor_area_sqm, row.personnel_count, row.address, row.barangay,
      row.owner_name, row.tel_no, row.tin,
    ].filter((v) => v !== null).length;

    if (row.business_name !== null && (row.business_permit_no !== null || usableFields >= 2)) {
      rows.push(row);
    } else {
      skipped.push({ rowNumber, reason: "No business name, or too few fields to identify a business", preview: previewOf(cells) });
    }
  }

  return { sheetName, layout, headerRowNumber, rows, skipped, problem: null };
}

function emptyRow(sheetName: string, rowNumber: number): MasterlistRow {
  return {
    sheetName,
    rowNumber,
    applic_type: null,
    business_permit_no: null,
    permit_date_issued: null,
    business_name: null,
    line_of_business: null,
    floor_area_sqm: null,
    personnel_count: null,
    address: null,
    barangay: null,
    owner_name: null,
    tel_no: null,
    tin: null,
    import_date_inspected: null,
    import_sssr: null,
    import_remarks: null,
    raw: [],
  };
}

function assignCell(row: MasterlistRow, field: keyof MasterlistRow, cell: Cell): void {
  if (cell === null || cell === "") return;

  switch (field) {
    case "floor_area_sqm": {
      const n = typeof cell === "number" ? cell : parseFloat(String(cell));
      if (Number.isFinite(n)) row.floor_area_sqm = n;
      return;
    }
    case "personnel_count": {
      const n = typeof cell === "number" ? cell : parseInt(String(cell), 10);
      if (Number.isFinite(n)) row.personnel_count = Math.round(n);
      return;
    }
    case "permit_date_issued":
    case "import_date_inspected": {
      // Date cells arrive as Date objects (cellDates). Anything else —
      // hand-typed text like "Feb 2026" — is kept verbatim rather than
      // guessed at.
      row[field] = cell instanceof Date ? toYmd(cell) : String(cell).trim();
      return;
    }
    case "business_permit_no": {
      // Validated, not just stored: "N/A", "-", "PENDING" are placeholders,
      // not identities. They become null here, so a placeholder can never be
      // the permit number two unrelated rows share. (A genuinely repeated real
      // permit number is the matcher's step 0.) The cell text stays in `raw`.
      const v = String(cell).trim().toUpperCase();
      row.business_permit_no = PERMIT_NO_PATTERN.test(v) ? v : null;
      return;
    }
    case "applic_type": {
      row.applic_type = String(cell).trim().toLowerCase();
      return;
    }
    default: {
      const text = String(cell).trim();
      if (text !== "") (row as any)[field] = text;
    }
  }
}

/** Dates become "YYYY-MM-DD" strings so `raw` is JSON- and Firestore-safe. */
function serializeCell(cell: Cell): string | number | null {
  if (cell === null) return null;
  if (cell instanceof Date) return toYmd(cell);
  if (typeof cell === "boolean") return String(cell);
  return cell;
}

function previewOf(cells: Cell[]): string {
  return cells
    .filter((c) => c !== null && c !== "")
    .slice(0, 4)
    .map((c) => (c instanceof Date ? toYmd(c) : String(c)))
    .join(" · ")
    .slice(0, 120);
}
