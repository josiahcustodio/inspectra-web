// [REF: MASTERLIST_EXPORT_PREFS]
//
// The one setting the masterlist Excel export has: whether to include the
// Category column. Category is a WEB-VIEW concept here — an establishment
// gets its category from the checklist its inspections are scored against,
// not from the uploaded masterlist — so the official export matches the
// city's Excel format (no Category column) unless an admin opts in, and the
// column is empty for anything not yet inspected.
//
// localStorage, not Firestore: this is a personal export preference of
// whoever is sitting at this browser, not shared data about establishments.

const INCLUDE_CATEGORY_KEY = "inspectra.masterlist.exportCategoryColumn";

export function exportIncludesCategory(): boolean {
  try {
    return localStorage.getItem(INCLUDE_CATEGORY_KEY) === "1";
  } catch {
    return false; // storage blocked (private mode etc.) -> the safe default
  }
}

export function setExportIncludesCategory(on: boolean): void {
  try {
    if (on) localStorage.setItem(INCLUDE_CATEGORY_KEY, "1");
    else localStorage.removeItem(INCLUDE_CATEGORY_KEY);
  } catch {
    // Nothing to do: the toggle simply won't persist.
  }
}
