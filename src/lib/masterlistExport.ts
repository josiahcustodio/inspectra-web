// [REF: MASTERLIST_EXPORT]
//
// Writes the masterlist back out as an .xlsx.
//
// WHY A SECOND SPREADSHEET LIBRARY. Imports are parsed with SheetJS (`xlsx`);
// ExcelJS owns the export. `xlsx` reads, ExcelJS writes. ExcelJS is about a
// megabyte, so it is loaded by dynamic import inside the one function that
// needs it: nobody who never clicks Export pays for it.

import type { Establishment } from "./models";

/** One line of the export: the establishment's masterlist columns, plus the
 *  two values that come from its latest inspection. */
export interface MasterlistExportRow {
  establishment: Establishment;
  category: string | null;
  /** Canonical "YYYY-MM-DD", never display prose — an export gets re-imported,
   *  and the import has to round-trip losslessly. */
  dateInspected: string | null;
  /** The inspection score for the SSSR column. A number when it is a real
   *  percentage, so the sheet can sort and average it; the imported text as-is
   *  when the establishment has never been inspected through the app. */
  sssr: number | string | null;
  remarks: string | null;
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

const SSSR_COLUMN = 13; // 1-based, matches COLUMNS above
const CATEGORY_COLUMN = COLUMNS.length + 1;

const addressTextOf = (est: Establishment): string =>
  typeof est.address === "string" ? est.address : "";

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
      row.sssr ?? "",
      row.dateInspected ?? "",
      row.remarks ?? "",
    ];
    if (options.includeCategory) values.push(row.category ?? "");

    const sheetRow = sheet.addRow(values);

    // A live score is written as a number so the column can be sorted and
    // averaged, and formatted so it still READS as a percentage. (Excel's own
    // "%" format would multiply by 100 and turn 87.5 into 8750%, so the unit
    // is part of the number format instead.)
    if (typeof row.sssr === "number") {
      sheetRow.getCell(SSSR_COLUMN).numFmt = '0.0"%"';
      sheetRow.getCell(SSSR_COLUMN).alignment = { horizontal: "right" };
    }
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return {
    buffer,
    result: { rows: rows.length },
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
