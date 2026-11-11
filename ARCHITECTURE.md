# Inspectra Web — architecture

The admin and officer dashboard for Inspectra, the sanitary inspection and risk
classification system used by the Batangas City Health Office. React 18 + Vite 6
+ TypeScript + Tailwind 4, reading and writing Supabase (Postgres via
PostgREST) directly from the browser. There is no backend of our own:
Supabase Auth (GoTrue) holds identities, Postgres holds data, and the
row-level-security policies (`migration/sql/02_rls.sql` in the Inspectra
root) are the only authority on who may read or write what.

The companion Flutter app (`inspectra-mobile`) is what inspectors use in the
field. It is the only writer of `inspection_logs`; this dashboard reads them.

## Layout

```
src/
  main.tsx              Mounts the tree: AuthProvider > ConnectionProvider > App, plus the Toaster.
  App.tsx               Hands off to the router. Five lines, nothing else belongs here.
  routes.tsx            The route map and the role-based landing redirect.
  vite-env.d.ts         Types for the VITE_SUPABASE_* env vars.

  pages/                One file per route. Each owns its own data subscriptions.
    Login.tsx           Email sign-in, and the TOTP challenge when an account has 2FA.
    Signup.tsx          Account creation, then straight to /verify-email.
    VerifyEmail.tsx     Holding page for a signed-in but unverified account.
    Dashboard.tsx       KPI tiles and the two compliance charts.
    Establishments.tsx  The establishment list, and the entry point to history.
    Inspections.tsx     Submitted inspection logs, paginated, with a details view.
    Inspectors.tsx      The inspector directory, merged from three sources.
    GISMap.tsx          Leaflet map of barangay-level compliance.
    Masterlist.tsx      Admin-only: the Excel-shaped full-column masterlist grid.
    (MasterlistImport.tsx moved to components/ — it is a dialog, not a route.)
    Settings.tsx        Account summary and TOTP enrolment.

  components/           Shared UI that is specific to this app.
    Layout.tsx          The signed-in shell: sidebar, role-prefixed nav, offline banner.
    AuthGuard.tsx       Gates a route subtree on session, verified email, and role.
    AddEstablishmentModal.tsx      Create/edit form for an establishment.
    EstablishmentHistoryModal.tsx  One establishment's inspection history and summary.
    InspectionChecklistView.tsx    Renders a submitted checklist read-only.
    PageStrip.tsx       The page-number control, driven by lib/pagination.
    ui/                 Generated primitives (shadcn/ui). Left uncommented on purpose
                        — treat as vendored. utils.ts holds the cn() helper.

  lib/                  Everything that is not a component.
    supabase.ts         Initialises the client, plus fetchAllRows() — the paged reader
                        every whole-table load goes through (PostgREST caps one response
                        at 1000 rows; a bare select would silently truncate).
    dataAccess.ts        Table names, row->model mappers, and the write helpers
                        (was firestore.ts until 2026-11-08).
    models.ts           The domain types. The schema contract with the mobile app.
    useCollection.ts    Reads a whole table and re-reads on every change (Supabase
                        Realtime); distinguishes loading from empty.
    useAuth.tsx         Session, profile, role, and the MFA assurance level (needsMfa).
                        Wraps Supabase Auth state.
    totp.ts             The one challenge->verify round-trip both TOTP flows share.
    ConnectionProvider.tsx  Online/offline state for the banner.
    ratingScale.ts      The sanitary rating bands, their labels, ranges and colours.
    exportPrefs.ts      The masterlist export's one setting (include Category column).
    masterlistExport.ts Writes the masterlist .xlsx, signature PNGs embedded in the
                        Date Inspected cells. ExcelJS, lazy-loaded; `xlsx` reads, this writes.
    import/             The masterlist importer, split by stage so each is readable alone:
      parseWorkbook.ts  Excel -> clean rows (header detection, layout fallbacks).
      matchRows.ts      Rows -> decisions (the identity-matching cascade).
      runImport.ts      Decisions -> Postgres (signature-grouped upserts, batch audit record).
      normalize.ts      Text normalisation and name similarity used by the above.
    inspectionDates.ts  Date handling for inspection logs, and the ordering convention.
    barangayGeo.ts      Barangay polygons, name normalisation, and establishment->barangay.
    pagination.ts       Builds the page-number sequence with ellipses.
    legacyOfflineCleanup.ts  One-off purge of the retired offline cache. Runs at boot.
    data/               PSA/PSGC barangay boundaries and codes, as JSON.

  styles/
    index.css           The single entry point; imports the other three in order.
    tailwind.css        Tailwind + tw-animate-css, and the @source scan path.
    theme.css           Design tokens as CSS variables.
    fonts.css           The Inter webfont.
```

Supporting directories: `docs/design-notes/` holds the original Figma design
briefs, `design-system/` and `guidelines/` the visual conventions.

## Conventions

**Imports.** `@/` whenever an import crosses a directory, `./` only for a
same-directory sibling. The alias points at `src/` and is declared in both
`tsconfig.json` and `vite.config.ts` — both must agree. Extensions are omitted
on TypeScript imports and kept on CSS and JSON.

**Comments explain why, not what.** The code says what it does; a comment is
there for the decision behind it, the constraint that forced it, or the bug it
prevents. Several in this codebase exist specifically to stop a past bug being
reintroduced — `useCollection.ts` on loading-versus-empty, `GISMap.tsx` on why
the map aggregates by barangay, `Settings.tsx` on the forced re-render. Those are
load-bearing; do not tidy them away.

**`[REF: ...]` anchors** mark the passage that owns a behaviour, and are the
index `docs/claude/ANCHORS.md` and the Word documentation in `docs/` point at. An anchor may appear in more
than one file when a convention is shared. Renaming one means updating the docs,
so prefer adding a new anchor to renaming an old one. Current index below.

**Pages own their own data.** There is no store. A page calls `useCollection`
for what it needs and derives the rest in a `useMemo`. Two pages wanting the
same figure compute it twice — deliberately, since the alternative is a cache to
keep correct.

**Data is cloud-only.** supabase-js keeps no local copy of table data, so nothing
survives a reload and the app can never serve a stale document or queue a write
it cannot deliver. That is stated explicitly in `supabase.ts` rather than left to
the SDK default, so turning persistence back on has to be a deliberate edit.

**`ui/` is vendored.** Those files came from a generator and carry no comments by
convention. Nine of the eleven are in use; the unused rest of the set was
deleted. Edit them only to fix a real defect.

## Checks

```
npx tsc --noEmit     # must be clean
npm run build         # must be clean
npm run dev           # needs .env with the VITE_SUPABASE_* values
```

`vite build` does not typecheck, so run `tsc` separately — a broken import can
build fine and fail at runtime.

## [REF:] index

Moved to `docs/claude/ANCHORS.md` (web + mobile, with line ranges and UI locations). The table that used to live here went stale.

