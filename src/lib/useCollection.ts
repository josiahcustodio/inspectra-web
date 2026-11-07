import { useEffect, useRef, useState } from "react";
import { supabase, fetchAllRows } from "./supabase";
import { useAuth } from "./useAuth";

export interface CollectionState<T> {
  /** `undefined` until the first read lands — lets callers tell "still loading" from "genuinely empty". */
  data: T[] | undefined;
  isLoading: boolean;
  error: Error | null;
}

// [REF: LIVE_COLLECTION]
//
// Reads a whole table and re-reads it on every server change, via Supabase
// Realtime (postgres_changes). Refetch-on-event rather than patching rows in
// place: the payload of a single event is not the whole truth (RLS-filtered,
// ordering-free), and a full re-read of these tables is cheap at this app's
// scale. Events respect RLS, so a user only hears about rows they could read
// anyway.
//
// The subscription is torn down on unmount and whenever the signed-in user
// changes, so a signed-out session never holds an open channel.
//
// `enabled` opts out of subscribing at all. It defaults to true, so a screen
// that always needs its table reads exactly as before; pass false to keep the
// channel closed until the UI that depends on it actually exists — a modal
// that has never been opened should not be holding a live query open.
// Last snapshot per table, kept for the life of the tab. Every portal page
// reads establishments, and without this each navigation re-downloaded all
// 5,000+ rows and showed zeroes until they arrived. A page now renders the
// previous snapshot at once and the refetch below replaces it when it lands.
const lastRows = new Map<string, any[]>();

export function useCollection<T>(
  path: string,
  map: (id: string, data: any) => T,
  enabled: boolean = true,
): CollectionState<T> {
  const { user } = useAuth();
  // The subscription must re-open when a DIFFERENT user signs in, but not
  // when the same user's token refreshes (useAuth replaces the user object
  // on every ~hourly TOKEN_REFRESHED) — keying the effect on the id, not the
  // object, avoids a teardown/resubscribe race and a full re-download each
  // refresh.
  const userId = user?.id ?? null;
  const [state, setState] = useState<CollectionState<T>>(() => {
    const cached = lastRows.get(path);
    return cached
      ? { data: cached.map((r) => map(r.id, r)), isLoading: true, error: null }
      : { data: undefined, isLoading: true, error: null };
  });

  // Callers may pass an inline mapper; keep the latest one without letting its
  // identity re-open the subscription.
  const mapRef = useRef(map);
  mapRef.current = map;

  useEffect(() => {
    // Left as `data: undefined` rather than `[]`: nothing has been read, so
    // callers must not be able to mistake this for a genuinely empty table.
    if (!enabled || !userId) {
      setState({ data: undefined, isLoading: false, error: null });
      return;
    }

    let cancelled = false;
    // Change events can arrive in bursts (an import touches thousands of
    // rows); coalesce them into one refetch per tick instead of one each.
    let refetchTimer: ReturnType<typeof setTimeout> | undefined;

    setState((prev) => ({ data: prev.data, isLoading: true, error: null }));

    const refetch = async () => {
      try {
        const rows = await fetchAllRows(path);
        if (cancelled) return;
        lastRows.set(path, rows);
        setState({
          data: rows.map((r) => mapRef.current(r.id, r)),
          isLoading: false,
          error: null,
        });
      } catch (error: any) {
        if (cancelled) return;
        console.error(`Live query for "${path}" failed:`, error);
        // Keep whatever was on screen; `error` tells the page what happened.
        setState((prev) => ({ data: prev.data ?? [], isLoading: false, error }));
      }
    };

    const scheduleRefetch = () => {
      if (refetchTimer) clearTimeout(refetchTimer);
      refetchTimer = setTimeout(refetch, 300);
    };

    refetch();

    // Channel topic must be unique PER HOOK INSTANCE, not per table: two
    // hooks sharing a topic silently collide in realtime-js — the second
    // subscribe() no-ops on the already-joined channel and either cleanup
    // removeChannel()s it out from under the other hook, which then stops
    // live-updating with no error.
    const channel = supabase
      .channel(`table:${path}:${crypto.randomUUID()}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: path },
        scheduleRefetch,
      )
      .subscribe();

    return () => {
      cancelled = true;
      if (refetchTimer) clearTimeout(refetchTimer);
      supabase.removeChannel(channel);
    };
  }, [path, userId, enabled]);

  return state;
}
