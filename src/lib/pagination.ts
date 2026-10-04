// [REF: PAGE_NUMBER_STRIP]
// Shared by every client-side pager in the dashboard. It lived in
// Inspections.tsx until the establishment history modal needed the same strip;
// one copy means the two pagers can never disagree about where the ellipses go.

// Page-number strip: every page when there are few, otherwise first/last with
// a window around the current page and ellipses for the gaps.
export function pageNumbers(current: number, total: number): (number | "…")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages: (number | "…")[] = [1];
  if (current > 3) pages.push("…");
  for (let p = Math.max(2, current - 1); p <= Math.min(total - 1, current + 1); p++) {
    pages.push(p);
  }
  if (current < total - 2) pages.push("…");
  pages.push(total);
  return pages;
}
