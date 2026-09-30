// [REF: OFFLINE_TEARDOWN]
//
// The app used to keep a Dexie (IndexedDB) mirror of every collection and ship a
// Workbox service worker that precached the app shell and map tiles. Both are
// gone, but they live in the browser of anyone who loaded an older build: the
// stale service worker would keep serving the old bundle, and the old database
// would sit there holding a copy of records this app no longer treats as a
// source of truth.
//
// This runs once at startup and removes them. Every step is best-effort — a
// browser that refuses any of it (private mode, unsupported API) must not stop
// the app from booting.
export function purgeLegacyOfflineStorage() {
  try {
    indexedDB.deleteDatabase('ClowtecDB');
  } catch {
    /* ignore */
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker
      .getRegistrations()
      .then((registrations) => registrations.forEach((r) => r.unregister()))
      .catch(() => {});
  }

  if ('caches' in window) {
    caches
      .keys()
      .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
      .catch(() => {});
  }
}
