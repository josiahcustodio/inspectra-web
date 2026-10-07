import { createClient } from "@supabase/supabase-js";

// [REF: WEB_SUPABASE_INIT]
//
// Cloud-only by construction, same stance the Firebase build had: supabase-js
// keeps no local copy of table data — only the auth session is persisted
// (localStorage), so the app can never serve stale rows or accept a write it
// cannot deliver.
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
);

// PostgREST caps a single response at the server's max-rows setting (1000 by
// default on Supabase). The masterlist alone is ~4500 establishments, so every
// whole-table read in the app goes through this pager instead of a bare
// select() — a bare select would silently truncate and the UI would just show
// fewer rows, which is exactly the kind of quiet data loss we can't have.
const PAGE = 1000;

export async function fetchAllRows(table: string): Promise<any[]> {
  const rows: any[] = [];
  for (let from = 0; ; from += PAGE) {
    // order('id') is load-bearing: LIMIT/OFFSET over an UNORDERED result is
    // non-deterministic across the separate page requests, so concurrent
    // writes could make rows skip or duplicate between pages.
    const { data, error } = await supabase
      .from(table)
      .select("*")
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) return rows;
  }
}
