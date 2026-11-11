# Inspectra web — admin SPA reference (this repo)

React 18.3 + react-router 7 + Vite 6 + Tailwind v4 (`@tailwindcss/vite`, no tailwind.config) + supabase-js 2.
Other libs: recharts (charts), leaflet (map), exceljs (xlsx write), `xlsx` 0.20.3 from SheetJS CDN tarball (xlsx read),
jspdf + jspdf-autotable (PDF), qrcode (MFA QR), sonner (toasts), Radix/shadcn primitives, input-otp.
Folder is literally named `File processing task` (Figma export leftover); `package.json` name is `inspectra-web`.

Scripts: `npm run dev` (http://localhost:5173), `npm run build` (vite, **no typecheck**; run `npx tsc --noEmit` yourself).
No test/lint scripts. Env (public, baked into bundle): `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` in untracked `.env`.
Deploy: push `main` → Render static site `inspectra-web` auto-builds (`npm ci && npm run build`, publish `dist`, SPA rewrite).
Production: `https://www.inspectra-cho.com` (Supabase site_url); `https://inspectra-web.onrender.com` still allow-listed.
`render.yaml` is documentation only; headers/env are entered by hand in the Render dashboard (see CLAUDE.md security invariants).

## File map

```
src/main.tsx            purgeLegacyOfflineStorage() → <AuthProvider><ConnectionProvider><App/> + <Toaster/>
src/App.tsx             <RouterProvider router/>
src/routes.tsx          route table (below)
src/components/
  AuthGuard.tsx         session/MFA/email/role gate; admin without TOTP → /admin/settings
  Layout.tsx            shell: sidebar (drawer < lg), role-prefixed nav, offline banner, account menu, sign out
  PageStrip.tsx         pagination control (uses lib/pagination pageNumbers)
  InspectionChecklistView.tsx  read-only log detail: rating, demerits, SO (if so_issued_at), remarks, results by sub_category; answerKind()
  SanitaryOrderView.tsx CHO-ESD-FR-04 render, window.print() via print.css [data-print-root], "Email copy" (admin) → send-sanitary-order
  AddEstablishmentModal.tsx  create/edit establishment; barangay list from lib/data/batangas_psgc.json (97 names); address stored as object
  EstablishmentHistoryModal.tsx  per-establishment logs (3/page) + summary + checklist view (passes establishment)
  BarangaySummaryDialog.tsx  AI executive report: scope (dates, barangays) → preview → generate-barangay-summary → jsPDF → logEvent REPORT
  ui/                   shadcn: button card dialog dropdown-menu input-otp input label pagination select sonner utils(cn)
src/pages/              Login VerifyEmail ResetPassword AccountStatus Dashboard Establishments Inspections GISMap
                        Inspectors Masterlist Access Audit Settings (MasterlistImport dialog lives in components/)
src/lib/
  supabase.ts           createClient; fetchAllRows(table) paged 1000, first page gives count, rest parallel
  dataAccess.ts         Supabase data access (was firestore.ts until 2026-11-08): COLLECTIONS, PERMITS_TABLE, map* snake→camel mappers,
                        saveEstablishment(id|null, payload) upsert, fetchInspectionDetails(logId). Dead: saveInspector, deleteInspector
  useAuth.tsx           AuthProvider/useAuth: user, session, role (profiles.role; missing → 'pending'), emailVerified, needsMfa, mfaEnrolled, retryProfile
  useCollection.ts      useCollection(table, map): fetchAllRows + realtime postgres_changes refetch (300 ms debounce), module cache per user:table
  ConnectionProvider.tsx isOnline (navigator.onLine); no write queue
  models.ts             TS types: Category, ChecklistTemplate, Establishment, InspectionLog, Profile, UploadBatch, ReviewQueueItem, Inspector
  ratingScale.ts        bands, PASSING_SCORE=70, isHighRisk, complianceLabel, UNSCORED_* labels (mirrors mobile core/rating_scale.dart)
  inspectionDates.ts    isoDatePart, formatShortDate, byNewestFirst, latestLogByEstablishment, relativeInspectionAge (zone-less = as written)
  barangayGeo.ts        BARANGAY_BOUNDARIES (105 PSGC polygons from data/batangas_barangays.geojson.json), BARANGAY_NAMES,
                        normalizeBarangay, BARANGAY_ALIASES (~30), POBLACION_PATTERN (Brgy/Poblacion N → "barangay N"), canonicalBarangay, barangayOfEstablishment
  complianceReportScope.ts  MAX_RANGE_DAYS=366, Manila-day → ISO instants, buildScopePreview
  complianceReportPdf.ts    buildComplianceReportPdf (A4: cover, KPIs, summary, distribution, actions, findings, scorecard, profiles, disclaimer)
  masterlistExport.ts   ExcelJS workbook with city masterlist COLUMNS (+ optional Category), saveWorkbook
  exportPrefs.ts        localStorage `inspectra.masterlist.exportCategoryColumn`
  auditEvents.ts        logEvent(kind, label) → rpc log_event, fire-and-forget
  totp.ts               challengeAndVerifyTotp(factorId, code) → AAL2
  pagination.ts         pageNumbers(current,total)
  legacyOfflineCleanup.ts  deletes IndexedDB ClowtecDB, service workers, caches (Firebase-era leftovers on user machines)
  import/               masterlist xlsx import: parseWorkbook.ts, normalize.ts, matchRows.ts, runImport.ts
  data/                 batangas_barangays.geojson.json (105), batangas_psgc.json (97 dropdown names)
src/styles/             index.css, theme.css, print.css
supabase/functions/     generate-barangay-summary, send-sanitary-order, provision-owner (obsolete) — see BACKEND.md §6
supabase/templates/     auth email templates — see BACKEND.md §5
docs/SECURITY_HEADERS.md  CSP rationale + ZAP triage; docs/design-notes/ = original Figma briefs (historical, band scheme differs)
scripts/check-compliance-pdf.mjs  manual PDF smoke (node scripts/check-compliance-pdf.mjs [outdir])
ARCHITECTURE.md         older architecture notes, partly stale (lists Signup.tsx, omits Access/Audit/ResetPassword, says import is a page)
```

## Routes (`src/routes.tsx`)

| Path | Component | Gate |
|---|---|---|
| `/login`, `/verify-email`, `/reset-password` | Login, VerifyEmail, ResetPassword | none (`/reset-password` needs `?token_hash=&type=recovery|invite`) |
| `/account` | AccountStatus | self-redirects to /login without session |
| `/` | RoleRedirect | admin → /admin/dashboard; department_head → /head/dashboard; pending/owner/officer → /account; needsMfa → /login; unverified → /verify-email |
| `/admin/{dashboard,establishments,inspections,gis-map,inspectors,masterlist,access,audit,settings}` | pages in Layout | `AuthGuard allowedRoles=['admin']` |
| `/head/{dashboard,establishments,inspections,gis-map,inspectors,masterlist,settings}` | same pages | `AuthGuard allowedRoles=['department_head']` |

No `/signup` (removed on purpose: web has no self-registration), no 404 route, no Google sign-in, no forgot-password link on web
(reset is requested from the mobile app and completed on web `/reset-password`).
Layout nav prefix is `/admin` for admin else `/head`; Access and Audit Trail are `adminOnly`. Write buttons in pages check `role === 'admin'`;
RLS is the real enforcement (department_head writes fail server-side).

## Auth on web

- `useAuth` listens to `onAuthStateChange` (incl. INITIAL_SESSION), defers `loadProfile` with `setTimeout(0)` (auth-lock deadlock).
  Role = `profiles.role` via maybeSingle; row missing/unknown → `'pending'`. When `needsMfa` (AAL1 with factor) profiles is not read (RLS would refuse).
- Login: password → if AAL1 + factor, same page shows 6-digit OTP pane (`listFactors().totp[0]` → `challengeAndVerifyTotp`).
  "email not confirmed" error → /verify-email. Sign In disabled until Terms checkbox (placeholder legal text, `shortcut:`).
  `logEvent("SIGN_IN")` after password (no factor) or after OTP success.
- Admin MFA is mandatory: AuthGuard sends a factor-less admin to `/admin/settings`; Settings shows the banner, hides Remove for admins,
  calls `retryProfile` after enrol. Server side `mfa_satisfied()` enforces it too. Lost authenticator = locked out until a maintainer
  runs `delete from auth.mfa_factors where user_id=...`.
- Department heads may enrol/remove TOTP optionally.
- ResetPassword: `verifyOtp({token_hash, type})` once → if account has a factor, ask TOTP → `updateUser({password})` (min 8) → signOut → /login.
- VerifyEmail: `auth.resend({type:'signup'})` with 30 s cooldown; "I've verified" re-reads user.
- AccountStatus: pending → "Waiting for activation"; officer/owner → "Use the Inspectra app"; auto-navigates to `/` when role becomes admin/department_head.

## Pages

**Dashboard** — reads establishments + inspection_logs. KPIs: Inspected Barangays (≥1 scored log, of 105), Inspected Establishments
(distinct establishment_id on any log / total), Active Compliance Rating (mean of **all** scored logs, not latest-per-establishment),
High-Risk Barangays (barangay mean < 70). Bar chart: 6 lowest-average barangays; pie: band distribution. Hosts BarangaySummaryDialog (both roles).

**Establishments** — sorted by name, 50/page; search name/owner/business_permit_no/sanitary_permit_no; canonical barangay filter.
Columns: Establishment, Owner, Permit No. (`business_permit_no || sanitary_permit_no`), Inspection Date + Compliance from latest log
(`complianceLabel`: lowest band shows "Fail"). Row click → EstablishmentHistoryModal. Add/Edit admin only. Does **not** hide delisted.

**Inspections** — newest first, 20/page; search establishment/inspector, barangay, from/to dates (isoDatePart). Status "Completed" when
`percentage_rating != null` else "Scheduled". Detail dialog → `fetchInspectionDetails(id)` → InspectionChecklistView **without `establishment`**
(known bug: SO prints blank Name/Address here; emailed copy is correct).

**GISMap** — Leaflet, tiles `https://tile.openstreetmap.org/{z}/{x}/{y}.png`, 105 barangay polygons. Each establishment joined to its latest log,
bucketed excellent / verySatisfactory / satisfactory / notInspected. Fill = worst band present in barangay; opacity `0.1 + density*0.2`;
risk-shading toggle. Pins for rows with numeric lat/lng (`[REF: GIS_PINS]`). Unresolvable barangays listed as "unmapped". Side panel worst-first
with `relativeInspectionAge`. Includes delisted.

**Inspectors** — directory merged from `inspectors` rows + `profiles` with role officer (by email) + bare `inspector_name` on logs
(case-insensitive). Period: All / 30 / 7 / 3 days / Today. Per inspector: total, today, distinct barangays/establishments, per-week rate.
Read-only. Known bug: undated logs (isoDatePart = "No Date") are counted in every period window.

**Masterlist** — both roles (header comment "Admin-only" is stale). City masterlist grid; live values from latest log: Date Inspected,
SSSR = `percentage_rating.toFixed(1)%`, Remarks = `ratingLabel`; unscored log → date + log.remarks; no log → `import_date_inspected/import_sssr/import_remarks` (muted).
Filters: search, group all/food/non_food, category, barangay, "show delisted" (hidden by default). 50/page.
Admin: Delist/Restore (`saveEstablishment(id,{status})` after confirm), Import (dialog → MasterlistImport).
Export to Excel: full filtered set, `masterlist-{group}-{YYYY-MM-DD}.xlsx`, Category column if pref on, then `logEvent("EXPORT")`.

**MasterlistImport** (dialog) — phases pick → preview (untick sheets) → running → done|failed. Admin picks food/non-food explicitly.
Run: `fetchAllRows('establishments')` → `buildMatchIndexes` → `decideRow` per row → `executeImport`. Report: counters + "missing from file"
(first 200). `ReviewQueuePanel`: pending `review_queue` items → merge / create / dismiss (`applyReviewDecision`). 42501 → RLS message.
Algorithm (`lib/import/`):
- parseWorkbook: header detection in first 6 rows via HEADER_ALIASES (needs `business_permit_no`); merged "Business Address" header → next
  unnamed column is barangay; BPLO positional layout fallback (permit col 2, Date col 3, TIN col 5); `PERMIT_NO_PATTERN /^[a-z]{1,4}\s?-?\s?\d{3,}(?:\s?-\s?\d+)?$/i`;
  row kept only if name AND (permit OR ≥2 other fields). Skip reasons: blank/title, repeated header, too few fields.
- normalize: `normText`, `permitKey` (upper, no spaces/dashes), `addressKey` (abbrev expansion), `locationKey → "street#barangay"`. TIN never used.
- matchRows `decideRow`: identity = group + normText(name) + locationKey. 0) permit seen in file → duplicate-in-file; 1) permit held by existing
  record → update-permit (or review `same-permit` if claimed); 2) same name+location → renewal if exactly one (or one from same sheet), review
  `same-name-same-address` / `same-name-unknown-address` / `already-claimed` otherwise, create if all claimed and has permit; 3) same name other
  location → create (`sameNameElsewhere`) unless street missing → review; 4) new → create. MAX_REVIEW_CANDIDATES=4.
- runImport `executeImport`: insert `upload_batches` running → chunks of 150: upsert establishments, then establishment_permits
  (onConflict establishment_id,permit_no), then review_queue; counters after each chunk → missing list (same group, unseen, not delisted, cap 2000) → done.
  Writes only non-blank cells + group, masterlist_sheet, `status:'active'` (revives delisted), last_seen_batch_id, updated_at; never category/inspection data.
  Review ids `rq-{djb2}{sdbm}` stable across runs.

**Access** (admin) — pages `profiles` (1000/page, max 5 pages → `truncated`), roles in pending/officer/department_head/admin.
Role change = `profiles.update({role})`. `ASSIGNABLE = pending|officer|department_head`; admin cannot be granted here
(maintainer uses `migration/promote_admin.py`), owner never set here (auto via triggers). Own row locked.

**Audit** (admin) — server-paged `audit_log` 25/page (`count:'exact'`, order at desc). Filters: type → table_name groups
(inspection_logs; establishments+permits; profiles; contacts+rejections; inspectors; templates+categories; events), date range, search
`actor_email.ilike OR row_label.ilike`. Each row rendered as one plain sentence (`describe()`) + before/after of `changed_fields` with
FIELD_LABEL map and HIDDEN regex. Excel export cap 5000 → `logEvent("EXPORT")`. Resolves ids via establishments + profiles.

**Settings** — Account (email, role), ExportSettings (admin: Category column toggle), SecuritySettings: TOTP enrol
(`mfa.enroll({factorType:'totp', issuer:'Inspectra'})`, QR via `QRCode.toDataURL` data: URL, manual secret, verify, `retryProfile`); Remove only for non-admins.

## Rating scale (`src/lib/ratingScale.ts`, contract shared with mobile)

| Band | Range | Colour | complianceLabel |
|---|---|---|---|
| excellent "Excellent" | 90–100 | #10B981 | Excellent |
| verySatisfactory "Very Satisfactory" | 70–89 | #F59E0B | Very Satisfactory |
| satisfactory "Satisfactory" | 0–69 | #EF4444 | **Fail** |

`PASSING_SCORE = 70`, `isHighRisk(s) = s < 70`. Unscored: label "Not yet inspected", colour #94A3B8, log label "Scheduled".
Web never computes scores; mobile writes `percentage_rating` = clamp(100 − Σ fail weights).

## Barangays

105 official PSGC barangays (polygons + names). Dropdown (`batangas_psgc.json`) has 97 names including "Talon" (no polygon).
`canonicalBarangay`: alias → poblacion rule (`Poblacion 022`, `Brgy. 5` → "barangay 22"/"barangay 5") → exact normalised → last resolving
comma-part. `barangayOfEstablishment`: `barangay` column → `address.barangay` → string address.

## Known issues / stale bits (as of 2026-11-08)

- Inspections detail SO blank name/address (no `establishment` prop). Inspectors undated-log period bug. No 404 page. Tab title "File processing task".
- Dashboard averages all logs while GIS/Establishments/Masterlist use latest-per-establishment; GIS + Establishments show delisted, Masterlist hides them.
- Dead: `saveInspector`, `deleteInspector`, `COLLECTIONS.checklistTemplates`, `provision-owner` function, `owner_access_rejections` table.
- Stale comments: Masterlist "Admin-only"; Access "approval queue"; "legacy sub-collection fallback"; SanitaryOrderView "no PDF library"; `Profile.role` doc omits department_head; SECURITY_HEADERS says checklist view renders `photo_evidence_url` (it doesn't).
- `shortcut:` markers: Login legal text, SanitaryOrderView hardcoded City Health Officer name, BarangaySummaryDialog preview cap 300.
- `pnpm.overrides` pins vite 6.3.5 vs devDependency ^6.4.1.
