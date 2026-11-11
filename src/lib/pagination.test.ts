// Shared page-number strip used by every client-side pager.
import { expect, test } from "vitest";
import { pageNumbers } from "./pagination";

test("seven pages or fewer are all listed", () => {
  expect(pageNumbers(1, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  expect(pageNumbers(1, 0)).toEqual([]);
});

test("a long list keeps first and last with a window around the current page", () => {
  expect(pageNumbers(1, 20)).toEqual([1, 2, "…", 20]);
  expect(pageNumbers(10, 20)).toEqual([1, "…", 9, 10, 11, "…", 20]);
  expect(pageNumbers(20, 20)).toEqual([1, "…", 19, 20]);
});
