import { useEffect, useRef, useState } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { firebaseDb } from "./firebase";
import { useAuth } from "./useAuth";

export interface CollectionState<T> {
  /** `undefined` until the first snapshot arrives — lets callers tell "still loading" from "genuinely empty". */
  data: T[] | undefined;
  isLoading: boolean;
  error: Error | null;
}

// [REF: LIVE_COLLECTION]
//
// Subscribes to a Firestore collection and re-renders on every server change.
// This replaces the old Dexie mirror + 15-second polling sync: updates now
// arrive when they happen, from any client, with no local copy to reconcile.
//
// The subscription is torn down on unmount and whenever the signed-in user
// changes, so a signed-out session never holds an open listener.
export function useCollection<T>(
  path: string,
  map: (id: string, data: any) => T,
): CollectionState<T> {
  const { user } = useAuth();
  const [state, setState] = useState<CollectionState<T>>({
    data: undefined,
    isLoading: true,
    error: null,
  });

  // Callers may pass an inline mapper; keep the latest one without letting its
  // identity re-open the subscription.
  const mapRef = useRef(map);
  mapRef.current = map;

  useEffect(() => {
    if (!user) {
      setState({ data: undefined, isLoading: false, error: null });
      return;
    }

    let cancelled = false;
    let unsubscribe: (() => void) | undefined;

    setState({ data: undefined, isLoading: true, error: null });

    // Firestore's internal auth-credential listener can lag `auth.currentUser`
    // right after a fresh sign-in: the user object is already set, but a
    // listener attached in that window comes back permission-denied even though
    // the security rules allow it. Forcing a token fetch is a real round-trip
    // that only resolves once that credential state has settled.
    user
      .getIdToken()
      .then(() => {
        if (cancelled) return;
        unsubscribe = onSnapshot(
          collection(firebaseDb, path),
          (snapshot) => {
            if (cancelled) return;
            setState({
              data: snapshot.docs.map((d) => mapRef.current(d.id, d.data())),
              isLoading: false,
              error: null,
            });
          },
          (error) => {
            if (cancelled) return;
            console.error(`Live query for "${path}" failed:`, error);
            setState({ data: [], isLoading: false, error });
          },
        );
      })
      .catch((error: Error) => {
        if (cancelled) return;
        setState({ data: [], isLoading: false, error });
      });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [path, user]);

  return state;
}
