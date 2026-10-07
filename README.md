# Inspectra Web

The admin and officer dashboard for **Inspectra**, the sanitary inspection and
risk classification system used by the Batangas City Health Office.

Inspectors collect inspections in the field with the Flutter app
(`inspectra-mobile`); this dashboard is where that data is reviewed — compliance
KPIs, the establishment register, submitted inspection logs, the inspector
directory, and a barangay-level GIS map of compliance.

React 18 · Vite 6 · TypeScript · Tailwind 4 · Firebase (Auth + Firestore).
No backend of our own: the browser talks to Firestore directly, and access is
enforced by `firestore.rules` in the mobile repo.

## Running it

```bash
npm install
npm run dev     # dev server, http://localhost:5173
npm run build   # production build into dist/
npx tsc --noEmit  # typecheck — `vite build` does not do this for you
```

`npm run dev` needs a `.env` in the project root supplying the Supabase
project config. The same keys are set in the Render dashboard for deploys —
see `render.yaml`:

```
VITE_SUPABASE_URL=
VITE_SUPABASE_PUBLISHABLE_KEY=
```

Vite bakes these into the bundle at build time, so they are public by design —
Postgres row-level security (migration/sql/02_rls.sql in the parent folder),
not secrecy, is what protects the data.

## Where things are

See **[ARCHITECTURE.md](ARCHITECTURE.md)** for the file-by-file map, the
conventions this codebase follows, and the index of `[REF:]` anchors that the
Word documentation points at. Start there before changing anything.

## Deployment

Render static site, blueprint in `render.yaml`. `npm ci && npm run build`,
published from `dist/`, with an SPA rewrite so client-side routes survive a
refresh.
