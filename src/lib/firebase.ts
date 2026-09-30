import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { initializeFirestore, memoryLocalCache } from "firebase/firestore";

// [REF: WEB_FIREBASE_INIT]
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// Cloud-only by construction: an in-memory cache lives for the lifetime of the
// tab and nothing survives a reload, so the app can never serve stale documents
// from disk or accept a write it cannot deliver. Stated explicitly rather than
// left to the SDK default so that turning persistence back on has to be a
// deliberate edit here.
export const firebaseDb = initializeFirestore(app, {
  localCache: memoryLocalCache(),
});
