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
  // order('id') is load-bearing: LIMIT/OFFSET over an UNORDERED result is
  // non-deterministic across the separate page requests, so concurrent
  // writes could make rows skip or duplicate between pages.
  const page = (from: number) =>
    supabase.from(table).select("*", { count: "exact" }).order("id").range(from, from + PAGE - 1);

  // The first page carries the total, so the remaining pages go out together
  // instead of one round-trip after another: establishments is 5,000+ rows,
  // and six sequential requests from a phone network was the dashboard's
  // whole load time.
  const first = await page(0);
  if (first.error) throw new Error(`${table}: ${first.error.message}`);
  const total = first.count ?? first.data?.length ?? 0;
  const rest = await Promise.all(
    Array.from({ length: Math.ceil(total / PAGE) - 1 }, (_, i) => page((i + 1) * PAGE)),
  );
  for (const r of rest) if (r.error) throw new Error(`${table}: ${r.error.message}`);
  return [...(first.data ?? []), ...rest.flatMap((r) => r.data ?? [])];
}
