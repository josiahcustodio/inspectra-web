// [REF: AI_BARANGAY_SUMMARY] — PDF half.
//
// Lays out the generate-barangay-summary response as an executive report. Runs
// entirely in the browser, so the report needs no storage bucket and no new CSP
// origin. Figures come from the function's aggregate.ts; only prose is AI-written.

import { RATING_BANDS, ratingBandSpec, UNSCORED_COLOR, UNSCORED_LOG_LABEL } from "@/lib/ratingScale";

export interface BarangayDigest {
  name: string;
  inspections: number;
  establishments_inspected: number;
  average_rating: number | null;
  bands: { excellent: number; very_satisfactory: number; satisfactory: number; unscored: number };
  top_failed_items: { item: string; failures: number }[];
  lowest_rated: { establishment: string; rating: number }[];
}

export interface ComplianceReport {
  from: string;
  to: string;
  city: BarangayDigest;
  barangays: BarangayDigest[];
  narrative: {
    executive_summary: string;
    citywide_findings: string;
    barangays: { name: string; assessment: string }[];
    other_barangays: string;
    recommended_actions: { priority: string; barangay: string; action: string; rationale: string }[];
  };
}

const INK = "#0F172A";
const BODY = "#334155";
const MUTED = "#64748B";
const RULE = "#E2E8F0";
const SURFACE = "#F8FAFC";
const BRAND = "#059669";
const BRAND_DARK = "#064E3B";
const BRAND_TINT = "#A7F3D0";

const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN = 18;
const CONTENT_W = PAGE_W - MARGIN * 2;
const TOP = 24;
const BOTTOM = PAGE_H - 20;

const TITLE = "Barangay Sanitary Compliance Report";
const DISCLAIMER = "AI-drafted from inspection data for review by the sanitary office. Not an official record.";

const BAND_KEYS = { excellent: "excellent", verySatisfactory: "very_satisfactory", satisfactory: "satisfactory" } as const;

const SYMBOLS: Record<string, string> = { "≥": ">=", "≤": "<=", "→": "->", "−": "-" };

/** The built-in PDF fonts only cover WinAnsi; anything else would print as garbage. */
export function pdfText(text: string): string {
  return text
    .normalize("NFC")
    .replace(/[≥≤→−]/g, (c) => SYMBOLS[c])
    .replace(/[^\n\x20-\x7E -ÿ–—‘’“”•…]/g, "");
}

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-PH", { dateStyle: "long", timeZone: "Asia/Manila" });

/** Manila's calendar date, yyyy-mm-dd, for the file name. */
const fileDate = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });

export function complianceReportFileName(report: Pick<ComplianceReport, "to">): string {
  return `Inspectra_Compliance_Report_${fileDate(report.to)}.pdf`;
}

const plural = (n: number, word: string) => `${n.toLocaleString("en-PH")} ${word}${n === 1 ? "" : "s"}`;
const ratingText = (avg: number | null) => (avg === null ? "No scored inspections" : `${avg}% ${ratingBandSpec(avg).label}`);

export async function buildComplianceReportPdf(report: ComplianceReport): Promise<{ blob: Blob; pages: number }> {
  // Loaded on demand, like exceljs: most dashboard visits never open a report.
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
  doc.setProperties({ title: TITLE, subject: `${formatDate(report.from)} to ${formatDate(report.to)}`, author: "Inspectra" });

  const { city, barangays, narrative } = report;
  const period = `${formatDate(report.from)} – ${formatDate(report.to)}`;
  let y = 0;

  const ensure = (height: number) => {
    if (y + height <= BOTTOM) return;
    doc.addPage();
    y = TOP;
  };

  const font = (size: number, color: string, style: "normal" | "bold" = "normal") => {
    doc.setFont("helvetica", style);
    doc.setFontSize(size);
    doc.setTextColor(color);
  };

  const lineHeight = (size: number) => size * 0.3528 * 1.45;

  const paragraph = (text: string, size = 10, color = BODY, width: number = CONTENT_W, x = MARGIN) => {
    font(size, color);
    for (const line of doc.splitTextToSize(pdfText(text), width) as string[]) {
      ensure(lineHeight(size));
      doc.text(line, x, y);
      y += lineHeight(size);
    }
  };

  const heading = (title: string) => {
    // Room for the first lines too, so a heading never strands at a page end.
    ensure(26);
    font(13, INK, "bold");
    doc.text(title, MARGIN, y + 3);
    doc.setDrawColor(BRAND);
    doc.setLineWidth(0.7);
    doc.line(MARGIN, y + 6, MARGIN + 12, y + 6);
    y += 12;
  };

  const bandBar = (b: BarangayDigest, x: number, top: number, width: number, height: number) => {
    const scored = b.bands.excellent + b.bands.very_satisfactory + b.bands.satisfactory;
    const segments = RATING_BANDS.map((spec) => ({ count: b.bands[BAND_KEYS[spec.band]], color: spec.color })).filter((s) => s.count > 0);
    const gap = 0.5;
    const usable = width - gap * (segments.length - 1);
    let cursor = x;
    for (const s of segments) {
      const w = (s.count / scored) * usable;
      doc.setFillColor(s.color);
      doc.roundedRect(cursor, top, w, height, Math.min(0.8, w / 2), Math.min(0.8, height / 2), "F");
      cursor += w + gap;
    }
  };

  const table = (head: string[], body: string[][], columnStyles: Record<number, object>, didDrawCell?: (data: any) => void) => {
    autoTable(doc, {
      startY: y,
      head: [head],
      body: body.map((row) => row.map(pdfText)),
      margin: { left: MARGIN, right: MARGIN, top: TOP, bottom: PAGE_H - BOTTOM },
      styles: { font: "helvetica", fontSize: 8.5, textColor: BODY, cellPadding: 2, lineColor: RULE, lineWidth: 0, valign: "top" },
      headStyles: { fillColor: BRAND_DARK, textColor: "#FFFFFF", fontStyle: "bold", fontSize: 8 },
      alternateRowStyles: { fillColor: SURFACE },
      columnStyles,
      didDrawCell,
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10;
  };

  // --- Cover band -----------------------------------------------------------
  doc.setFillColor(BRAND_DARK);
  doc.rect(0, 0, PAGE_W, 58, "F");
  doc.setFillColor(BRAND);
  doc.rect(0, 58, PAGE_W, 1.5, "F");
  font(9, BRAND_TINT, "bold");
  doc.text("CITY HEALTH OFFICE  •  BATANGAS CITY", MARGIN, 19);
  font(24, "#FFFFFF", "bold");
  doc.text("Barangay Sanitary", MARGIN, 31);
  doc.text("Compliance Report", MARGIN, 41);
  font(10, "#FFFFFF");
  doc.text(`Reporting period: ${period}`, MARGIN, 50);
  font(8, BRAND_TINT, "bold");
  doc.text("EXECUTIVE REPORT  •  AI-DRAFTED", PAGE_W - MARGIN, 19, { align: "right" });

  // --- KPI tiles ------------------------------------------------------------
  y = 68;
  const tiles: [string, string, string][] = [
    ["AVERAGE RATING", city.average_rating === null ? "–" : `${city.average_rating}%`, city.average_rating === null ? "No scored inspections" : ratingBandSpec(city.average_rating).label],
    ["INSPECTIONS", city.inspections.toLocaleString("en-PH"), "in this period"],
    ["ESTABLISHMENTS", city.establishments_inspected.toLocaleString("en-PH"), "inspected"],
    ["BARANGAYS", barangays.length.toLocaleString("en-PH"), "covered"],
  ];
  const tileGap = 4;
  const tileW = (CONTENT_W - tileGap * 3) / 4;
  tiles.forEach(([label, value, note], i) => {
    const x = MARGIN + i * (tileW + tileGap);
    doc.setFillColor(SURFACE);
    doc.setDrawColor(RULE);
    doc.setLineWidth(0.2);
    doc.roundedRect(x, y, tileW, 25, 1.5, 1.5, "FD");
    font(7, MUTED, "bold");
    doc.text(label, x + 4, y + 6.5);
    font(20, INK, "bold");
    doc.text(value, x + 4, y + 15.5);
    font(8, MUTED);
    doc.text(note, x + 4, y + 21);
  });
  y += 35;

  // --- Executive summary ----------------------------------------------------
  heading("Executive Summary");
  paragraph(narrative.executive_summary, 10.5, INK);
  y += 8;

  // --- Rating distribution --------------------------------------------------
  const scored = city.bands.excellent + city.bands.very_satisfactory + city.bands.satisfactory;
  if (scored > 0) {
    ensure(44);
    heading("Rating Distribution");
    bandBar(city, MARGIN, y, CONTENT_W, 6);
    y += 12;
    RATING_BANDS.forEach((spec, i) => {
      const count = city.bands[BAND_KEYS[spec.band]];
      const x = MARGIN + (i * CONTENT_W) / 3;
      doc.setFillColor(spec.color);
      doc.circle(x + 1.2, y - 1, 1.2, "F");
      font(9, INK, "bold");
      doc.text(`${Math.round((count / scored) * 100)}%`, x + 4, y);
      font(8.5, BODY);
      doc.text(pdfText(`${spec.label} (${spec.range})`), x + 4, y + 4.5);
      font(8, MUTED);
      doc.text(plural(count, "inspection"), x + 4, y + 8.5);
    });
    y += 14;
    // The scale's naming misleads anyone who hasn't seen it: flag it where they read it.
    paragraph("Note: Satisfactory is the lowest band on this scale. Scores of 0–69 are non-passing and need follow-up.", 8, MUTED);
    if (city.bands.unscored > 0) {
      paragraph(`${plural(city.bands.unscored, "inspection")} with status ${UNSCORED_LOG_LABEL} had no score and are excluded from these percentages.`, 8, MUTED);
    }
    y += 8;
  }

  // --- Recommended actions --------------------------------------------------
  if (narrative.recommended_actions.length > 0) {
    heading("Recommended Actions");
    table(
      ["Priority", "Barangay", "Action", "Why"],
      narrative.recommended_actions.map((a) => [a.priority, a.barangay, a.action, a.rationale]),
      { 0: { cellWidth: 17, fontStyle: "bold", textColor: INK }, 1: { cellWidth: 30 } },
    );
  }

  // --- City-wide findings ---------------------------------------------------
  heading("City-wide Findings");
  paragraph(narrative.citywide_findings);
  y += 7;

  if (city.top_failed_items.length > 0) {
    ensure(14 + city.top_failed_items.length * 13);
    font(10, INK, "bold");
    doc.text("Most frequently failed checklist items", MARGIN, y);
    y += 6;
    const most = city.top_failed_items[0].failures;
    const barMax = CONTENT_W - 12;
    for (const { item, failures } of city.top_failed_items) {
      paragraph(item, 8.5, BODY);
      const w = Math.max((failures / most) * barMax, 1);
      doc.setFillColor(BRAND);
      doc.roundedRect(MARGIN, y - 1.5, w, 2.6, 0.8, 0.8, "F");
      font(8.5, INK, "bold");
      doc.text(String(failures), MARGIN + w + 2, y + 0.6);
      y += 7;
    }
    y += 5;
  }

  if (city.lowest_rated.length > 0) {
    ensure(30);
    font(10, INK, "bold");
    doc.text("Lowest-rated establishments", MARGIN, y);
    y += 3;
    table(
      ["Establishment", "Lowest score", "Band"],
      city.lowest_rated.map((e) => [e.establishment, `${e.rating}%`, ratingBandSpec(e.rating).label]),
      { 1: { cellWidth: 26 }, 2: { cellWidth: 36 } },
    );
  }

  // --- Scorecard ------------------------------------------------------------
  heading("Barangay Scorecard");
  paragraph("All barangays inspected in this period, lowest average rating first.", 8.5, MUTED);
  y += 2;
  const ranked = [...barangays].sort((a, b) => (a.average_rating ?? Infinity) - (b.average_rating ?? Infinity));
  table(
    ["Barangay", "Inspections", "Establishments", "Average rating", "Excellent", "Very Sat.", "Sat."],
    ranked.map((b) => [
      b.name,
      String(b.inspections),
      String(b.establishments_inspected),
      `      ${ratingText(b.average_rating)}`,
      String(b.bands.excellent),
      String(b.bands.very_satisfactory),
      String(b.bands.satisfactory),
    ]),
    {
      1: { cellWidth: 21, halign: "right" },
      2: { cellWidth: 26, halign: "right" },
      3: { cellWidth: 42 },
      4: { cellWidth: 17, halign: "right" },
      5: { cellWidth: 15, halign: "right" },
      6: { cellWidth: 10, halign: "right" },
    },
    (data) => {
      if (data.section !== "body" || data.column.index !== 3) return;
      const avg = ranked[data.row.index].average_rating;
      doc.setFillColor(avg === null ? UNSCORED_COLOR : ratingBandSpec(avg).color);
      doc.circle(data.cell.x + 3, data.cell.y + 3.4, 1.1, "F");
    },
  );

  // --- Barangay profiles ----------------------------------------------------
  const assessments = new Map(narrative.barangays.map((b) => [b.name.trim().toLowerCase(), b.assessment]));
  const profiled = barangays.filter((b) => assessments.has(b.name.trim().toLowerCase()));
  if (profiled.length > 0) heading("Barangay Profiles");
  for (const b of profiled) {
    const assessment = pdfText(assessments.get(b.name.trim().toLowerCase())!);
    const violations = b.top_failed_items.map((v) => `${v.item} (${v.failures})`).join(", ");
    const lowest = b.lowest_rated.map((e) => `${e.establishment} (${e.rating}%)`).join(", ");
    const hasScores = b.average_rating !== null;

    // Keep each profile whole: measure it, then break the page before it if needed.
    font(9.5, BODY);
    const measure = (text: string, size: number) => {
      doc.setFontSize(size);
      return (doc.splitTextToSize(pdfText(text), CONTENT_W) as string[]).length * lineHeight(size);
    };
    const height =
      12 + (hasScores ? 7 : 0) + measure(assessment, 9.5) +
      (violations ? measure(`Recurring violations: ${violations}`, 8.5) + 1 : 0) +
      (lowest ? measure(`Lowest rated: ${lowest}`, 8.5) + 1 : 0) + 8;
    ensure(height);

    font(11, INK, "bold");
    const nameLines = doc.splitTextToSize(pdfText(b.name), CONTENT_W - 62) as string[];
    doc.text(nameLines[0], MARGIN, y);
    const rating = pdfText(ratingText(b.average_rating));
    font(9, INK, "bold");
    doc.text(rating, PAGE_W - MARGIN, y, { align: "right" });
    doc.setFillColor(hasScores ? ratingBandSpec(b.average_rating!).color : UNSCORED_COLOR);
    doc.circle(PAGE_W - MARGIN - doc.getTextWidth(rating) - 2.5, y - 1.1, 1.2, "F");
    y += 5;

    font(8.5, MUTED);
    doc.text(
      `${plural(b.inspections, "inspection")}  •  ${plural(b.establishments_inspected, "establishment")}  •  ` +
        `Excellent ${b.bands.excellent}  •  Very Satisfactory ${b.bands.very_satisfactory}  •  Satisfactory ${b.bands.satisfactory}`,
      MARGIN, y,
    );
    y += 2.5;
    if (hasScores) {
      bandBar(b, MARGIN, y, CONTENT_W, 2.2);
      y += 7;
    } else {
      y += 3;
    }

    paragraph(assessment, 9.5);
    y += 1;
    if (violations) {
      paragraph(`Recurring violations: ${violations}`, 8.5, MUTED);
      y += 1;
    }
    if (lowest) {
      paragraph(`Lowest rated: ${lowest}`, 8.5, MUTED);
      y += 1;
    }
    y += 2;
    doc.setDrawColor(RULE);
    doc.setLineWidth(0.2);
    doc.line(MARGIN, y, PAGE_W - MARGIN, y);
    y += 6;
  }

  if (narrative.other_barangays.trim()) {
    heading("Other Barangays");
    paragraph(narrative.other_barangays);
    y += 8;
  }

  // --- Method ---------------------------------------------------------------
  heading("About This Report");
  paragraph(
    "All figures are computed directly from inspection records for the reporting period. The written assessments are drafted by AI from those " +
      "figures and from inspector notes, and should be reviewed by the sanitary office before use or circulation. Ratings run from 0 to 100: " +
      "Excellent (90–100), Very Satisfactory (70–89), and Satisfactory (0–69), which is the lowest band.",
    8.5, MUTED,
  );

  // --- Running header and footer (page count is only known now) --------------
  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page);
    if (page > 1) {
      font(8, MUTED, "bold");
      doc.text(TITLE, MARGIN, 13);
      font(8, MUTED);
      doc.text(period, PAGE_W - MARGIN, 13, { align: "right" });
      doc.setDrawColor(RULE);
      doc.setLineWidth(0.2);
      doc.line(MARGIN, 16, PAGE_W - MARGIN, 16);
    }
    doc.setDrawColor(RULE);
    doc.setLineWidth(0.2);
    doc.line(MARGIN, PAGE_H - 15, PAGE_W - MARGIN, PAGE_H - 15);
    font(7.5, MUTED);
    doc.text(DISCLAIMER, MARGIN, PAGE_H - 10);
    doc.text(`Page ${page} of ${pages}`, PAGE_W - MARGIN, PAGE_H - 10, { align: "right" });
  }

  return { blob: doc.output("blob"), pages };
}
