import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { pageNumbers } from "@/lib/pagination";

// [REF: PAGE_NUMBER_STRIP]
// The Previous / numbers / Next control itself, so the inspections list and the
// establishment history modal share one implementation rather than two copies
// of the same disabled-edge and active-page handling.
interface PageStripProps {
  current: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  /** Passed through to the <nav>, which is how callers align the strip. */
  className?: string;
}

export function PageStrip({ current, pageCount, onPageChange, className }: PageStripProps) {
  const isFirst = current <= 1;
  const isLast = current >= pageCount;

  // The edge controls render as plain anchors, and `pointer-events-none` only
  // stops the mouse — the anchor keeps its tab stop, so Enter on a greyed-out
  // "Previous" still fired this handler and walked the page index to 0 and then
  // negative, which slices an empty window and blanks the whole list. Clamping
  // here makes an out-of-range page unrepresentable however it was requested;
  // `tabIndex={-1}` below then takes the dead controls out of the tab order so
  // they cannot be reached in the first place.
  function goTo(page: number) {
    const next = Math.min(Math.max(page, 1), Math.max(pageCount, 1));
    if (next !== current) onPageChange(next);
  }

  return (
    <Pagination className={className}>
      <PaginationContent>
        <PaginationItem>
          <PaginationPrevious
            href="#"
            aria-disabled={isFirst}
            tabIndex={isFirst ? -1 : undefined}
            className={isFirst ? "pointer-events-none opacity-50" : ""}
            onClick={(e) => { e.preventDefault(); goTo(current - 1); }}
          />
        </PaginationItem>
        {pageNumbers(current, pageCount).map((p, idx) => (
          <PaginationItem key={idx}>
            {p === "…" ? (
              <span className="px-2 text-muted-foreground">…</span>
            ) : (
              <PaginationLink
                href="#"
                isActive={p === current}
                onClick={(e) => { e.preventDefault(); goTo(p as number); }}
              >
                {p}
              </PaginationLink>
            )}
          </PaginationItem>
        ))}
        <PaginationItem>
          <PaginationNext
            href="#"
            aria-disabled={isLast}
            tabIndex={isLast ? -1 : undefined}
            className={isLast ? "pointer-events-none opacity-50" : ""}
            onClick={(e) => { e.preventDefault(); goTo(current + 1); }}
          />
        </PaginationItem>
      </PaginationContent>
    </Pagination>
  );
}
