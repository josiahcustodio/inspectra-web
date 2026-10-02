# Inspectra Web — architecture

The admin and officer dashboard for Inspectra, the sanitary inspection and risk
classification system used by the Batangas City Health Office. React 18 + Vite 6
+ TypeScript + Tailwind 4, reading and writing Firestore directly from the
browser. There is no backend of our own: Firebase Auth holds identities,
Firestore holds data, and `firestore.rules` in the mobile repo is the only
authority on who may read or write what.

The companion Flutter app (`inspectra-mobile`) is what inspectors use in the
field. It is the only writer of `inspection_logs`; this dashboard reads them.

## Layout

```
src/
  main.tsx              Mounts the tree: AuthProvider > ConnectionProvider > App, plus the Toaster.
  App.tsx               Hands off to the router. Five lines, nothing else belongs here.
  routes.tsx            The route map and the role-based landing redirect.
  vite-env.d.ts         Types for the VITE_FIREBASE_* env vars.

  pages/                One file per route. Each owns its own data subscriptions.
    Login.tsx           Email + Google sign-in, and the TOTP challenge when an account has 2FA.
    Signup.tsx          Account creation, then straight to /verify-email.
    VerifyEmail.tsx     Holding page for a signed-in but unverified account.
    Dashboard.tsx       KPI tiles and the two compliance charts.
    Establishments.tsx  The establishment list, and the entry point to history.
    Inspections.tsx     Submitted inspection logs, paginated, with a details view.
    Inspectors.tsx      The inspector directory, merged from three sources.
    GISMap.tsx          Leaflet map of barangay-level compliance.
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
    firebase.ts         Initialises the SDK. Firestore is pinned to memoryLocalCache().
    firestore.ts        Collection names, document->model mappers, and the write helpers.
    models.ts           The domain types. The schema contract with the mobile app.
    useCollection.ts    Subscribes to a collection live; distinguishes loading from empty.
    useAuth.tsx         Session, profile and role. Wraps Firebase Auth state.
    ConnectionProvider.tsx  Online/offline state for the banner.
    ratingScale.ts      The sanitary rating bands, their labels, ranges and colours.
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
index the Word documentation in `docs/` points at. An anchor may appear in more
than one file when a convention is shared. Renaming one means updating the docs,
so prefer adding a new anchor to renaming an old one. Current index below.

**Pages own their own data.** There is no store. A page calls `useCollection`
for what it needs and derives the rest in a `useMemo`. Two pages wanting the
same figure compute it twice — deliberately, since the alternative is a cache to
keep correct.

**Data is cloud-only.** Firestore runs with `memoryLocalCache()`, so nothing
survives a reload and the app can never serve a stale document or queue a write
it cannot deliver. That is stated explicitly in `firebase.ts` rather than left to
the SDK default, so turning persistence back on has to be a deliberate edit.

**`ui/` is vendored.** Those files came from a generator and carry no comments by
convention. Nine of the eleven are in use; the unused rest of the set was
deleted. Edit them only to fix a real defect.

## Checks

```
npx tsc --noEmit     # must be clean
npm run build         # must be clean
npm run dev           # needs .env with the VITE_FIREBASE_* values
```

`vite build` does not typecheck, so run `tsc` separately — a broken import can
build fine and fail at runtime.

## [REF:] index

| Anchor | Owned by |
|---|---|
| `ADMIN_SHELL` | components/Layout.tsx |
| `BARANGAY_ALIASES` | lib/barangayGeo.ts |
| `BARANGAY_GEO` | lib/barangayGeo.ts |
| `BAR_GRAPH` | pages/Dashboard.tsx |
| `CARD_SURFACE_STYLE` | pages/Dashboard.tsx |
| `CLOUD_DATA_ACCESS` | lib/firestore.ts |
| `CONNECTION_STATUS` | lib/ConnectionProvider.tsx |
| `DOMAIN_MODELS` | lib/models.ts |
| `EMAIL_VERIFICATION_CHECK` | pages/VerifyEmail.tsx |
| `ESTABLISHMENT_FORM_SAVE` | components/AddEstablishmentModal.tsx |
| `ESTABLISHMENT_HISTORY_MODAL` | components/EstablishmentHistoryModal.tsx, pages/Establishments.tsx |
| `ESTABLISHMENT_HISTORY_SUMMARY` | components/EstablishmentHistoryModal.tsx |
| `ESTABLISHMENT_LIST` | pages/Establishments.tsx |
| `ESTABLISHMENT_WRITE` | lib/firestore.ts |
| `GIS_BARANGAY_AGGREGATION` | pages/GISMap.tsx |
| `GIS_BARANGAY_MODEL` | pages/GISMap.tsx |
| `GIS_EMPTY_STATE` | pages/GISMap.tsx |
| `GIS_MAP` | pages/GISMap.tsx |
| `GIS_UNMAPPED` | pages/GISMap.tsx |
| `INSPECTION_CHECKLIST_VIEW` | components/InspectionChecklistView.tsx |
| `INSPECTION_DATE_CONVENTION` | components/EstablishmentHistoryModal.tsx, components/InspectionChecklistView.tsx, lib/inspectionDates.ts, pages/GISMap.tsx, pages/Inspections.tsx |
| `INSPECTION_DETAILS_FETCH_WEB` | lib/firestore.ts |
| `INSPECTION_DETAILS_VIEW_WEB` | pages/Inspections.tsx |
| `INSPECTION_LIST` | pages/Inspections.tsx |
| `INSPECTION_PAGINATION` | pages/Inspections.tsx |
| `INSPECTOR_DIRECTORY` | pages/Inspectors.tsx |
| `INSPECTOR_WRITE` | lib/firestore.ts |
| `KPI_STATS` | pages/Dashboard.tsx |
| `LIVE_COLLECTION` | lib/useCollection.ts |
| `MFA_TOTP_ENROLL` | pages/Settings.tsx |
| `OFFLINE_BANNER` | components/Layout.tsx |
| `OFFLINE_TEARDOWN` | lib/legacyOfflineCleanup.ts |
| `PAGE_NUMBER_STRIP` | components/PageStrip.tsx, lib/pagination.ts |
| `PIE_GRAPH` | pages/Dashboard.tsx |
| `RATING_SCALE` | components/EstablishmentHistoryModal.tsx, lib/ratingScale.ts, pages/Dashboard.tsx, pages/GISMap.tsx, pages/Inspections.tsx |
| `ROLE_NAV` | components/Layout.tsx |
| `ROLE_REDIRECT` | routes.tsx |
| `WEB_APP_BOOTSTRAP` | main.tsx |
| `WEB_AUTH_GUARD` | components/AuthGuard.tsx |
| `WEB_AUTH_STATE` | lib/useAuth.tsx |
| `WEB_DESIGN_TOKENS` | styles/theme.css |
| `WEB_FIREBASE_INIT` | lib/firebase.ts |
| `WEB_MFA_CHALLENGE` | pages/Login.tsx |
| `WEB_PROFILE_BOOTSTRAP` | lib/useAuth.tsx |
| `WEB_ROUTE_MAP` | routes.tsx |
| `WEB_SIGNIN_EMAIL` | pages/Login.tsx |
| `WEB_SIGNUP` | pages/Signup.tsx |
| `WEB_STYLE_ENTRY` | styles/index.css |

