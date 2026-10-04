// [REF: MASTERLIST_EXPORT]
//
// Writes the masterlist back out as an .xlsx, with each inspector's signature
// PNG embedded in the Date Inspected cell, above the date — the paper form's
// SSSR column had a wet-ink signature beside the date, and this is the same
// record in the same place.
//
// WHY A SECOND SPREADSHEET LIBRARY. Imports are parsed with SheetJS (`xlsx`),
// which reads these messy workbooks well but cannot write images at all in the
// community build. ExcelJS can anchor an image over a cell, so it owns the
// export. The two never meet: `xlsx` reads, ExcelJS writes. ExcelJS is also
// about a megabyte, so it is loaded by dynamic import inside the one function
// that needs it — nobody who never clicks Export pays for it.
//
// An embedded image is a FLOATING object anchored to a cell, not cell content.
// So the date stays the cell's value (bottom-aligned, and still a real string
// a spreadsheet can sort), the row is made tall enough for both, and the
// signature is anchored into the top portion of the same cell. That is why the
// signature survives sorting the sheet in Excel only as well as any image does
// — it is pinned to the cell position, not to the row's data. A reader who
// re-sorts a signed export should treat the dates as authoritative.

import type { Establishment } from "./models";

/** One line of the export: the establishment's masterlist columns, plus the
 *  two values that come from its latest inspection. */
export interface MasterlistExportRow {
  establishment: Establishment;
  category: string | null;
  /** Canonical "YYYY-MM-DD", never display prose — an export gets re-imported,
   *  and the import has to round-trip losslessly. */
  dateInspected: string | null;
  remarks: string | null;
  /** Storage download URL of the inspector's sign-off, or null when the
   *  establishment has never been inspected through the app (or the phone has
   *  not uploaded the image yet). */
  signatureUrl: string | null;
}

export interface MasterlistExportOptions {
  /** Whether to append the Category column — off by default, because it is
   *  web-view data rather than part of the city's own format (see
   *  lib/exportPrefs.ts). */
  includeCategory: boolean;
  fileName: string;
}

export interface MasterlistExportResult {
  rows: number;
  signaturesEmbedded: number;
  /** Signatures that could not be fetched. The export still writes — a
   *  missing image must not cost the admin the whole file — so the caller
   *  reports this rather than treating it as failure. */
  signaturesFailed: number;
}

/** Column headers, in the order the city's own masterlist uses. */
const COLUMNS = [
  { header: "No.", width: 6 },
  { header: "Applic. Type", width: 13 },
  { header: "Permit No.", width: 14 },
  { header: "Date Issued", width: 12 },
  { header: "Business Trade Name", width: 38 },
  { header: "Line/Kind of Business", width: 32 },
  { header: "Flr. Area (SqM.)", width: 10 },
  { header: "No. of Employee", width: 10 },
  { header: "Business Address", width: 34 },
  { header: "Barangay", width: 20 },
  { header: "Owner's Name", width: 30 },
  { header: "Tel. No", width: 16 },
  { header: "SSSR", width: 10 },
  { header: "Date Inspected", width: 22 },
  { header: "REMARKS", width: 20 },
] as const;

const DATE_INSPECTED_COLUMN = 14; // 1-based, matches COLUMNS above
const CATEGORY_COLUMN = COLUMNS.length + 1;

// A signature PNG is captured ~600px wide. These are the printed dimensions
// inside the cell, in pixels: wide enough to read, short enough to leave the
// date legible underneath on one taller-than-normal row.
const SIGNATURE_WIDTH = 104;
const SIGNATURE_HEIGHT = 26;
const SIGNED_ROW_HEIGHT = 42; // points; the default is ~15

// Signature downloads run in parallel, but not unboundedly: a fully inspected
// city list would otherwise open thousands of sockets at once.
const FETCH_CONCURRENCY = 8;

const addressTextOf = (est: Establishment): string =>
  typeof est.address === "string" ? est.address : "";

/** Fetch each signature PNG, a few at a time. A failure resolves to null
 *  rather than rejecting, so one unreachable image cannot sink the export. */
async function fetchSignatures(
  urls: (string | null)[],
): Promise<(ArrayBuffer | null)[]> {
  const out: (ArrayBuffer | null)[] = new Array(urls.length).fill(null);
  let next = 0;

  const worker = async (): Promise<void> => {
    while (next < urls.length) {
      const index = next++;
      const url = urls[index];
      if (!url) continue;
      try {
        const response = await fetch(url);
        if (response.ok) out[index] = await response.arrayBuffer();
      } catch {
        // Left null; counted as a failure by the caller.
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(FETCH_CONCURRENCY, urls.length) }, worker),
  );
  return out;
}

/** Builds the workbook and hands it to the browser as a download. */
export async function exportMasterlistToExcel(
  rows: MasterlistExportRow[],
  options: MasterlistExportOptions,
): Promise<MasterlistExportResult> {
  const { buffer, result } = await buildMasterlistWorkbook(rows, options);
  saveWorkbook(buffer, options.fileName);
  return result;
}

/** The workbook itself, as bytes. Split from the download step so the sheet
 *  building — which is all of the real logic — can be exercised outside a
 *  browser, where Blob and <a download> do not exist. */
export async function buildMasterlistWorkbook(
  rows: MasterlistExportRow[],
  options: MasterlistExportOptions,
): Promise<{ buffer: ArrayBuffer; result: MasterlistExportResult }> {
  // Dynamic import: keeps roughly a megabyte of spreadsheet writer out of the
  // bundle every other page pays to load.
  const ExcelJS = await import("exceljs");

  const signatures = await fetchSignatures(rows.map((r) => r.signatureUrl));

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Masterlist");

  const headers: string[] = COLUMNS.map((c) => c.header);
  if (options.includeCategory) headers.push("Category");
  sheet.addRow(headers);
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: "frozen", ySplit: 1 }];

  COLUMNS.forEach((column, index) => {
    sheet.getColumn(index + 1).width = column.width;
  });
  if (options.includeCategory) sheet.getColumn(CATEGORY_COLUMN).width = 24;

  let embedded = 0;
  let failed = 0;

  rows.forEach((row, index) => {
    const est = row.establishment;
    const values: (string | number)[] = [
      index + 1,
      est.applic_type ?? "",
      est.business_permit_no ?? "",
      est.permit_date_issued ?? "",
      est.business_name,
      est.line_of_business ?? "",
      est.floor_area_sqm ?? "",
      est.personnel_count ?? "",
      addressTextOf(est),
      est.barangay ?? "",
      est.owner_name ?? "",
      est.tel_no ?? "",
      est.import_sssr ?? "",
      row.dateInspected ?? "",
      row.remarks ?? "",
    ];
    if (options.includeCategory) values.push(row.category ?? "");

    const sheetRow = sheet.addRow(values);

    const png = signatures[index];
    if (row.signatureUrl && !png) failed += 1;
    if (!png) return;

    // The date sits at the bottom of the cell so the signature can occupy the
    // space above it.
    sheetRow.getCell(DATE_INSPECTED_COLUMN).alignment = {
      vertical: "bottom",
      horizontal: "center",
    };
    sheetRow.height = SIGNED_ROW_HEIGHT;

    const imageId = workbook.addImage({ buffer: png as any, extension: "png" });
    // tl is a zero-based, fractional cell coordinate: the top-left corner of
    // the Date Inspected cell on this row.
    sheet.addImage(imageId, {
      tl: { col: DATE_INSPECTED_COLUMN - 1, row: sheetRow.number - 1 },
      ext: { width: SIGNATURE_WIDTH, height: SIGNATURE_HEIGHT },
      editAs: "oneCell",
    });
    embedded += 1;
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return {
    buffer,
    result: { rows: rows.length, signaturesEmbedded: embedded, signaturesFailed: failed },
  };
}

/** Hand the finished workbook to the browser as a download. */
function saveWorkbook(buffer: ArrayBuffer, fileName: string): void {
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  // Revoked on the next tick, not immediately: Safari reads the blob after the
  // click handler returns.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
