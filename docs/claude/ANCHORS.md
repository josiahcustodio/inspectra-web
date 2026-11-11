# `[REF: …]` anchor index — web + mobile

Anchors are comments in the source (`// [REF: NAME]`) that mark the passage owning a behaviour. They change nothing at
runtime; they exist so docs, reviews and the manuscript can point at code by name instead of by line number.
Line ranges below are as of **2026-11-08** and drift with every edit; `Grep "\[REF: NAME\]"` is always the truth.
Web paths are relative to this repo (`src/` unless noted); mobile paths are relative to `inspectra-mobile/lib/`.

Rules: one anchor per behaviour; reuse the same name where one convention is applied in several files (`RATING_SCALE`,
`INSPECTION_DATE_CONVENTION`, `EMPTY_SNAPSHOT_GUARD`); a comment that *mentions* another anchor ("see [REF: X]") is not a
definition. Prefer adding a new anchor over renaming one. Update this file when an anchor moves file.

Audit 2026-11-08: web 82 anchors / 100 sites, 0 dangling. Mobile 109 anchors / 130 sites, 1 dangling mention fixed
(`NEW_USER_IS_POWERLESS` → `PENDING_APPROVAL`). The old index in `ARCHITECTURE.md` was stale (listed `GIS_UNMAPPED`,
`WEB_SIGNUP`, missed ~25 newer anchors) and now points here. `INSPECTOR_WRITE` sits on dead code; `PROVISION_OWNER` on an
obsolete Edge Function. `WEB_FORGOT_PASSWORD` exists only in the uncommitted working tree of `Login.tsx`.

---

## Web (`inspectra-web`)

UI column = where you see it: sidebar entry (admin at `/admin/*`, department head at `/head/*`) and the control inside it.

### Boot, routing, shell

| Anchor | Where | What | UI |
|---|---|---|---|
| `WEB_APP_BOOTSTRAP` | `main.tsx` 9–21 | purge Firebase-era storage, mount Auth/Connection providers, router, toaster | app start |
| `WEB_ROUTE_MAP` | `routes.tsx` 64–145 | route table; `/admin/*` and `/head/*` wrapped in `AuthGuard` + `Layout` | all URLs |
| `ROLE_REDIRECT` | `routes.tsx` 19–62 | `/` sends each role to its home (admin/head dashboard, others `/account`) | landing on `/` |
| `ROLE_REDIRECT_NON_STAFF` | `routes.tsx` 36–43 | pending / owner / officer → `/account`, never into the shell | — |
| `WEB_AUTH_GUARD` | `components/AuthGuard.tsx` 10–75 | session → MFA → email → role gate; admin/department head without TOTP forced to Settings | every shell page |
| `ADMIN_SHELL` | `components/Layout.tsx` 48–203 | sidebar (drawer < lg), header, account menu, sign out, content scroller | the frame around every page |
| `ROLE_NAV` | `components/Layout.tsx` 61–69 | `/admin` vs `/head` prefix; `adminOnly` items hidden for department head | sidebar items (Access, Audit Trail admin-only) |
| `OFFLINE_BANNER` | `components/Layout.tsx` 181–192 | amber "You are offline" strip | top of page content when offline |
| `CONNECTION_STATUS` | `lib/ConnectionProvider.tsx` 11–39 | `isOnline` from `navigator.onLine`; no write queue | feeds the banner |
| `WEB_SUPABASE_INIT` | `lib/supabase.ts` 3–41 | client (no local table cache) + `fetchAllRows` paged 1000 | — |
| `CLOUD_DATA_ACCESS` | `lib/dataAccess.ts` 10–240 | Supabase data access (was `firestore.ts`): `COLLECTIONS`, snake→camel mappers | — |
| `ESTABLISHMENT_WRITE` | `lib/dataAccess.ts` 171–187 | `saveEstablishment(id\|null, payload)` upsert | Add/Edit establishment → Save |
| `INSPECTOR_WRITE` | `lib/dataAccess.ts` 189–209 | `saveInspector` / `deleteInspector` — **dead, no caller** | none |
| `INSPECTION_DETAILS_FETCH_WEB` | `lib/dataAccess.ts` 221–236 | one log with `results` (also typed at `lib/models.ts` 142) | row click on Inspections / history modal |
| `LIVE_COLLECTION` | `lib/useCollection.ts` 12–123 | fetch-all + realtime refetch (300 ms debounce), cache per user:table | every list page |
| `DOMAIN_MODELS` | `lib/models.ts` 1–253 | TS types for all tables | — |
| `OFFLINE_TEARDOWN` | `lib/legacyOfflineCleanup.ts` 1–34 | delete IndexedDB `ClowtecDB`, service workers, caches | app start |
| `WEB_STYLE_ENTRY` | `styles/index.css` 1–end | the one stylesheet: fonts → theme → tailwind → print | — |
| `WEB_DESIGN_TOKENS` | `styles/theme.css` 1–end | CSS variables for colours, radii, type | — |
| `PRINT_ROOT` | `styles/print.css` 1–52 | print only the `[data-print-root]` element | Sanitary Order → "Print / Save as PDF" |
| `CARD_SURFACE_STYLE` | `pages/Dashboard.tsx` 29–31 | `glassCard` class string shared by dashboard cards | Dashboard cards |

### Auth and account pages

| Anchor | Where | What | UI |
|---|---|---|---|
| `WEB_APP_ROLE` | `lib/useAuth.tsx` 5–14 | `AppRole` union | — |
| `WEB_PROFILE_BOOTSTRAP` | `lib/useAuth.tsx` 84–174 | `loadProfile`: email verified, MFA state, role from `profiles` | after sign-in |
| `NO_CLIENT_ROLE_FALLBACK` | `lib/useAuth.tsx` 113–140 | missing/unknown profile → `'pending'`, never a staff role | — |
| `WEB_AUTH_STATE` | `lib/useAuth.tsx` 198–227 | `onAuthStateChange` listener, `setTimeout(0)` to dodge the auth lock | — |
| `WEB_SIGNIN_EMAIL` | `pages/Login.tsx` 66–99 | email + password sign-in, unconfirmed email → `/verify-email` | Login → "Sign in" |
| `WEB_FORGOT_PASSWORD` | `pages/Login.tsx` 106–127 | reset-link dialog (**uncommitted** working-tree change, also 3-strikes auto-open) | Login → "Forgot password?" → "Send reset link" |
| `WEB_MFA_CHALLENGE` | `pages/Login.tsx` 129–158 | TOTP step after password | Login → "Two-factor verification" OTP boxes |
| `TOTP_CHALLENGE_VERIFY` | `lib/totp.ts` 3–23 | `challengeAndVerifyTotp(factorId, code)` → AAL2 | used by Login + Settings |
| `MFA_TOTP_ENROLL` | `pages/Settings.tsx` 28–237 | `SecuritySettings`: enrol QR, verify 6 digits, remove factor | Settings → "Two-Factor Authentication" → Enable / Remove |
| `EMAIL_VERIFICATION_CHECK` | `pages/VerifyEmail.tsx` 76–98 | re-read user, continue when confirmed | Verify-email page → check button |
| `WEB_RESET_PASSWORD` | `pages/ResetPassword.tsx` 12–158 | verify `token_hash` (recovery/invite) then `updateUser` | `/reset-password` form |
| `WEB_ACCOUNT_STATUS` | `pages/AccountStatus.tsx` 8–149 | "waiting for activation" page for pending/owner/officer | `/account` → "Check again" |
| `ACCOUNT_STATUS_SESSION` | `pages/AccountStatus.tsx` 30–39 | no session → `/login` (route is outside AuthGuard on purpose) | — |
| `WEB_ACCESS_PAGE` | `pages/Access.tsx` 16–265 | accounts list, role dropdown, activation | sidebar **Access** (admin) |

### Dashboard

| Anchor | Where | What | UI |
|---|---|---|---|
| `KPI_STATS` | `pages/Dashboard.tsx` 43–138 | memo: inspected establishments/barangays, band tallies, high-risk barangays | 4 KPI cards at top |
| `AI_BARANGAY_SUMMARY` | `pages/Dashboard.tsx` 179–180 (mount) · `components/BarangaySummaryDialog.tsx` 20–334 (dialog) · `lib/complianceReportScope.ts` 1–120 (dates/barangays → scope) · `lib/complianceReportPdf.ts` 1–411 (jsPDF) · `supabase/functions/generate-barangay-summary/index.ts` 1–255 (Claude call) | executive compliance report, end to end | Dashboard header → "AI Compliance Summary" → From/To + barangays (Select all / Clear) → "View Full Report" → "Download" |
| `BAR_GRAPH` | `pages/Dashboard.tsx` 283–307 | per-barangay bar chart (recharts) | middle card |
| `PIE_GRAPH` | `pages/Dashboard.tsx` 333–356 | compliance donut, legend generated from `RATING_BANDS` | right card |

### Establishments

| Anchor | Where | What | UI |
|---|---|---|---|
| `ESTABLISHMENT_LIST` | `pages/Establishments.tsx` 140–229 | table: name, owner, permit, last inspection, compliance, actions | sidebar **Establishments** |
| `ESTABLISHMENT_HISTORY_MODAL` | `pages/Establishments.tsx` 157–178 (row click) · `components/EstablishmentHistoryModal.tsx` 50–419 (modal) | per-establishment logs, 3/page, checklist on the right | click any table row |
| `ESTABLISHMENT_HISTORY_SUMMARY` | `components/EstablishmentHistoryModal.tsx` 128–163 | count, latest score, last inspected | strip at top of the modal |
| `ESTABLISHMENT_FORM_SAVE` | `components/AddEstablishmentModal.tsx` 114–176 | validate, build address object, `saveEstablishment` | "Add Establishment" (header) / pencil "Edit Establishment" (row) → Save |
| `INSPECTION_CHECKLIST_VIEW` | `components/InspectionChecklistView.tsx` 8–219 | read-only log: rating, demerits, remarks, results by sub-category, SO if issued | right pane of history modal; Inspections detail dialog |
| `SANITARY_ORDER_VIEW` | `components/SanitaryOrderView.tsx` 11–308 | CHO-ESD-FR-04 render, print, email via Edge Function | inside checklist view when `so_issued_at` → "Print / Save as PDF", "Email copy" (admin) |

### Inspections

| Anchor | Where | What | UI |
|---|---|---|---|
| `INSPECTION_LIST` | `pages/Inspections.tsx` 58–95 | rows from `useCollection`, flattened + labelled | sidebar **Inspections** table |
| `INSPECTION_FILTERS` | `pages/Inspections.tsx` 97–126 | search, barangay, status, date | filter bar → "Clear filters" |
| `INSPECTION_PAGINATION` | `pages/Inspections.tsx` 128–137 | page count / slice | strip under the table |
| `INSPECTION_DETAILS_VIEW_WEB` | `pages/Inspections.tsx` 139–365 | selected row → fetch details → dialog | click a row |
| `PAGE_NUMBER_STRIP` | `components/PageStrip.tsx` 11–end · `lib/pagination.ts` 1–19 | page-number control + `pageNumbers()` ellipsis logic | under Establishments, Inspections, Masterlist, Audit tables |
| `INSPECTION_DATE_CONVENTION` | `lib/inspectionDates.ts` 1–185 | zone-less `inspection_date` shown as written; used at `InspectionChecklistView.tsx` 95, `Inspections.tsx` 88, `EstablishmentHistoryModal.tsx` 356 | every date cell |
| `RATING_SCALE` | `lib/ratingScale.ts` 1–118 | bands, `PASSING_SCORE`, colours (mirror of mobile `core/rating_scale.dart`); used at `Dashboard.tsx` 67, `Inspections.tsx` 83, `GISMap.tsx` 48 + 532, `EstablishmentHistoryModal.tsx` 274 | every rating badge / legend |

### GIS Map

| Anchor | Where | What | UI |
|---|---|---|---|
| `GIS_MAP` | `pages/GISMap.tsx` 100–613 | Leaflet page: polygons, search, side panel, shading toggle | sidebar **GIS Map** |
| `GIS_BARANGAY_MODEL` | `pages/GISMap.tsx` 29–46 | `EstablishmentRow` (null score ≠ zero) | — |
| `GIS_BARANGAY_AGGREGATION` | `pages/GISMap.tsx` 121–215 | memo: `byBarangay`, `citywide`, `unmapped`, `pins` | side panel numbers |
| `GIS_PINS` | `pages/GISMap.tsx` 324–347 | marker layer for rows with lat/lng | pins on the map |
| `GIS_EMPTY_STATE` | `pages/GISMap.tsx` 466–493 | "No establishments to show yet" card | bottom-centre of map |
| `BARANGAY_GEO` | `lib/barangayGeo.ts` 1–197 | 105 PSGC polygons, `canonicalBarangay`, `barangayOfEstablishment` | — |
| `BARANGAY_ALIASES` | `lib/barangayGeo.ts` 69–123 | spelling/alias table (~30) | — |

### Inspectors

| Anchor | Where | What | UI |
|---|---|---|---|
| `INSPECTOR_PERIOD` | `pages/Inspectors.tsx` 23–34 | period options for the stats | period select, top right |
| `INSPECTOR_DIRECTORY` | `pages/Inspectors.tsx` 60–398 | page: per-inspector counts, barangays covered, avg/week | sidebar **Inspectors** |
| `INSPECTOR_DETAILS` | `pages/Inspectors.tsx` 177–397 | selected inspector's inspections dialog | click a row |

### Masterlist and import

| Anchor | Where | What | UI |
|---|---|---|---|
| `MASTERLIST_GRID` | `pages/Masterlist.tsx` 1–536 | city masterlist grid, Food / Non-Food, filters, Import + Export | sidebar **Masterlist** |
| `ESTABLISHMENT_DELIST` | `pages/Masterlist.tsx` 95–101 (state; handlers below) | only place that sets `status='delisted'` / restores | row action (admin) + "show delisted" toggle |
| `MASTERLIST_EXPORT` | `lib/masterlistExport.ts` 1–153 | ExcelJS workbook with city columns (+ optional Category) | Masterlist → "Export" |
| `MASTERLIST_EXPORT_PREFS` | `lib/exportPrefs.ts` 1–31 · `pages/Settings.tsx` 239–280 | localStorage flag for the Category column | Settings → "Masterlist Export" card |
| `MASTERLIST_IMPORT_PAGE` | `components/MasterlistImport.tsx` 1–706 | import wizard: file → sheet/layout → preview → run → report | Masterlist → "Import" (dialog, not a route) |
| `MASTERLIST_REVIEW_QUEUE` | `components/MasterlistImport.tsx` 293–420 | `ReviewQueuePanel`: rows set aside for a human | "Set aside" panel inside the import dialog |
| `MASTERLIST_PARSE` | `lib/import/parseWorkbook.ts` 1–536 | xlsx → rows per sheet layout | — |
| `MASTERLIST_HEADER_DETECT` | `lib/import/parseWorkbook.ts` 208–218 | find the header row in the first 6 lines | — |
| `MASTERLIST_NORMALIZE` | `lib/import/normalize.ts` 1–116 | text/permit/address keys for exact comparison | — |
| `MASTERLIST_MATCH_CASCADE` | `lib/import/matchRows.ts` 1–391 | permit → name+address → review candidates | — |
| `MASTERLIST_IMPORT_WRITES` | `lib/import/runImport.ts` 1–497 | batches, `upload_batches`, `review_queue`, revive delisted | progress bar in the dialog |

### Audit trail

| Anchor | Where | What | UI |
|---|---|---|---|
| `AUDIT_TRAIL_PAGE` | `pages/Audit.tsx` 13–443 | `audit_log` rows as plain sentences, filters, paging | sidebar **Audit Trail** (admin) → "Refresh" |
| `AUDIT_EXPORT` | `pages/Audit.tsx` 254–293 | capped export of the filtered trail | "Export to Excel" |
| `AUDIT_EVENTS` | `lib/auditEvents.ts` 3–16 | `logEvent(kind,label)` → RPC `log_event`, fire-and-forget | sign-in, exports, reports |

### Edge Functions (`supabase/functions/`)

| Anchor | Where | What | UI |
|---|---|---|---|
| `SO_EMAIL_DELIVERY` | `send-sanitary-order/index.ts` 1–255 | auth check, load order, render, Brevo send, stamp `email_sent_at` | "Email copy" button |
| `SO_EMAIL_RENDER` | `send-sanitary-order/render.ts` 1–273 | HTML/text body of the order email | — |
| `SO_EMAIL_ESCAPE` | `send-sanitary-order/render.ts` 43–60 (test `render.test.ts` 49) | escape inspector free text | — |
| `SO_EMAIL_DATE_ZONE` | `send-sanitary-order/render.ts` 62–81 (test `render.test.ts` 108) | dates in Asia/Manila | — |
| `PROVISION_OWNER` | `provision-owner/index.ts` 1–248 | **obsolete** — owner grants now come from DB triggers | none |
| `NEVER_DEMOTE_STAFF` | `provision-owner/index.ts` 163–174 | admin/officer never downgraded to owner | none |

---

## Mobile (`inspectra-mobile`, paths under `lib/`)

Shell tabs (bottom bar): **Home · Establishments · [Map FAB] · History · Profile**. Other screens: Login, Splash/sync,
Verify email, MFA enrol/verify, Pending approval, Inspection form (`/inspection`), Inspection details, Owner home.

### Boot, routing, theme

| Anchor | Where | What | UI |
|---|---|---|---|
| `APP_BOOTSTRAP` | `main.dart` 16–79 | Supabase + Hive init, providers, router, `UpdateGate` | app start |
| `AUTH_ROUTE_GUARD` | `core/router/app_router.dart` 36–147 | redirect chain: session → role → pending → owner → AAL2 → email → factor | every navigation |
| `ROLE_ROUTE_BRANCH` | `core/router/app_router.dart` 55–83 · `ui/screens/splash_sync_screen.dart` 33–51 | role → inspector shell / owner / pending | after splash |
| `EMPTY_SNAPSHOT_GUARD` | `data/services/offline_service.dart` 202–224 (categories), 336–358 (establishments), 399–411 (templates) · `core/router/app_router.dart` 68–83 (owner skips sync) | an empty server page never wipes a working cache | — |
| `NAV_SHELL` | `core/router/app_router.dart` 211–264 | `StatefulShellRoute`, 5 branches | bottom bar |
| `BOTTOM_NAV_TABS` | `ui/screens/main_navigation_screen.dart` 122–164 | tab builder + centre Map FAB | Home / Establishments / Map / History / Profile |
| `STARTUP_SYNC` | `ui/screens/splash_sync_screen.dart` 31–107 | ensure role, pull master data, route | splash spinner |
| `ROLE_UNKNOWN_DEADLOCK` | `ui/screens/splash_sync_screen.dart` 59–76 | role null → "Could not confirm your account" | splash → Retry / Sign out |
| `DESIGN_TOKENS` | `core/theme/app_theme.dart` 5–167 | `ThemeData` | — |
| `COLOR_TOKENS` | `core/theme/app_colors.dart` 3–110 | palette constants | — |

### Sign-in, roles, MFA

| Anchor | Where | What | UI |
|---|---|---|---|
| `LOGIN_SCREEN` | `ui/screens/login_screen.dart` 11–814 | inspector sign-in + three dialogs | Login |
| `AUTH_SIGNIN_EMAIL` | `data/services/auth_service.dart` 9–22 | `signInWithPassword` | Login → "Sign In" |
| `AUTH_SIGNUP_EMAIL` | `data/services/auth_service.dart` 24–47 | `signUp` with `display_name` | "Create Account" dialog |
| `SIGNUP_DIALOG` | `ui/screens/login_screen.dart` 712–813 | sign-up form; snackbar says admin must activate | Login → "Create Account" → "Sign Up" |
| `FORGOT_PASSWORD_DIALOG` | `ui/screens/login_screen.dart` 384–437 | `resetPasswordForEmail` (link completes on web) | Login → "Forgot Password?" → "Send Link" |
| `OWNER_SIGNIN_ENTRY` | `ui/screens/login_screen.dart` 289–309 | "or" divider + owner button | Login, below the password form |
| `OWNER_SIGNIN_DIALOG` | `ui/screens/login_screen.dart` 439–710 | email → 6-digit code → verify, resend timer | owner dialog → "Sign In" |
| `OWNER_OTP_SCOPE` | `ui/screens/login_screen.dart` 528–557 | OTP login refused for non-owner roles | — |
| `OWNER_OTP_SIGNIN` | `data/services/auth_service.dart` 121–140 | `signInWithOtp(shouldCreateUser: true)` | — |
| `OWNER_OTP_FLOW` | `providers/auth_provider.dart` 170–186 | send/verify wrappers | — |
| `AUTH_ERROR_MESSAGES` | `data/services/auth_service.dart` 234–266 | Supabase errors → friendly text | snackbars |
| `ROLE_LOOKUP` | `data/services/auth_service.dart` 164–212 | `fetchRole()` reads `profiles.role` | — |
| `ROLE_CACHE` | `data/services/auth_service.dart` 176–212 | cache role in Hive, serve it offline | — |
| `ROLE_CACHE_KEY` | `data/services/offline_service.dart` 71–77 | `role:<uid>` key (per account) | — |
| `ROLE_STATE` | `providers/auth_provider.dart` 23–46 | `role`, `roleUnknown`, `isOwner` | — |
| `AUTH_STATE_LISTENER` | `providers/auth_provider.dart` 76–105 | `onAuthStateChange`; **ignores `tokenRefreshed`** (loop guard) | — |
| `MFA_ENROLL_START` / `MFA_ENROLL_CONFIRM` / `MFA_SIGNIN_CHALLENGE` | `data/services/mfa_service.dart` 73–105 / 110–129 / 133–152 | TOTP enrol, confirm, challenge+verify | MFA screens |
| `MFA_ENROLL_SCREEN` / `MFA_ENROLL_VERIFY` | `ui/screens/mfa_enroll_screen.dart` 45–76 / 78–112 | QR + secret, 6-digit verify | MFA enrol → "Verify" |
| `MFA_VERIFY_SCREEN` | `ui/screens/mfa_verify_screen.dart` 33–49 | sign-in challenge | MFA verify → "Verify" / "Back to Sign In" |
| `EMAIL_VERIFY_POLLING` | `ui/screens/verify_email_screen.dart` 29–32 | 4 s poll for confirmation | Verify email → "Resend Verification Email" |
| `PENDING_APPROVAL` | `ui/screens/pending_approval_screen.dart` 8–185 | waiting page for `pending` role | → "Check again" |

### Offline cache and sync

| Anchor | Where | What | UI |
|---|---|---|---|
| `OFFLINE_CACHE_INIT` | `data/services/offline_service.dart` 22–33 | register adapters, open 5 boxes | app start |
| `CACHE_BOX_SELF_HEAL` | `data/services/offline_service.dart` 35–63 | corrupt box → delete and reopen | — |
| `MASTER_DATA_SYNC` | `data/services/offline_service.dart` 168–417 | `syncData()`: categories, establishments, templates (paged) | splash; Profile → sync |
| `DELISTED_FILTER` | `data/services/offline_service.dart` 241–264 | skip `status='delisted'` before caching | Establishments tab never shows them |
| `ESTABLISHMENT_UPGRADE_BRIDGE` | `data/services/offline_service.dart` 294–324 | keep records an old build created offline (one-release bridge) | — |
| `CATEGORY_PICKER_OPTIONS` | `data/services/offline_service.dart` 432–457 | `CategoryOption` rows, availability decided here | category dropdown |
| `CHECKLIST_TEMPLATE_LOOKUP` | `data/services/offline_service.dart` 459–476 | templates by category **id** | — |
| `TEMPLATE_LOOKUP_ID_BRIDGE` | `data/services/offline_service.dart` 478–548 | name fallback for boxes cached before `categoryId` | — |
| `PIN_LOCATION` | `data/services/offline_service.dart` 84–102 (queue + drain) · `ui/screens/inspection_form_screen.dart` 84–90 (state), 939–994 (GPS fix + confirm) | the only establishment write mobile makes | Inspection form banner → "Pin GPS location here" / "Update pinned location" |
| `INSPECTION_SUBMIT_REMOTE` | `data/services/sync_service.dart` 14–23 | `inspection_logs` upsert | Submit |
| `OFFLINE_SYNC_QUEUE` | `data/services/sync_service.dart` 56–77 | drain queue, last-write-wins | Home → pending card → "Sync Now" |
| `SYNC_SINGLE_ITEM` | `data/services/sync_service.dart` 80–93 | one queued log | pending modal → per-row submit |
| `INSPECTION_HISTORY_FETCH` | `data/services/sync_service.dart` 125–217 | last 50 logs, RLS-scoped, name join | History tab |
| `ESTABLISHMENT_NAME_BACKFILL` | `data/services/sync_service.dart` 227–248 | background `establishment_name` update | — |
| `INSPECTION_DETAILS_FETCH` | `data/services/sync_service.dart` 255–274 | one log by id | details screen |
| `PENDING_COUNTER` | `providers/pending_inspections_provider.dart` 48–57 | queue size | Home → pending card badge |
| `SYNC_ALL_TRIGGER` | `providers/pending_inspections_provider.dart` 59–87 | `submitAll()` | pending modal → "Submit All" |
| `PENDING_CARD` / `PENDING_QUEUE_MODAL` | `ui/widgets/pending_card.dart` 8–240 / 135–239 | card + bottom-sheet list of queued inspections | Home tab |
| `HISTORY_MERGE_LOCAL_REMOTE` | `providers/inspection_history_provider.dart` 48–139 | queued + remote logs, generation counter vs sign-out races | History tab list |

### Models

| Anchor | Where | What | UI |
|---|---|---|---|
| `INSPECTION_CATEGORY_MODEL` | `data/models/inspection_category.dart` 7–51 | Hive typeId 2 | — |
| `CATEGORY_AVAILABILITY` | `data/models/inspection_category.dart` 53–80 | `CategoryUnavailableReason` (no template, all weights 0) | disabled rows in picker |
| `CATEGORY_OPTION` | `data/models/inspection_category.dart` 82–163 | picker row: category + availability | — |
| `CHECKLIST_FIELDS` | `data/models/checklist_template.dart` 37–86 · `ui/widgets/checklist_item_card.dart` 105–112 (render) | optional blanks / Y-N per item (`fields` json) | inputs above Pass/Fail/N/A |
| `ESTABLISHMENT_MASTERLIST_FIELDS` | `data/models/establishment.dart` 62–85 | Hive fields 14–20, read-only masterlist copies | establishment sheet |
| `ESTABLISHMENT_COORDINATES` | `data/models/establishment.dart` 87–122 | fields 21–22 lat/lng, `hasLocation` | map pins |
| `ESTABLISHMENT_FULL_ADDRESS` | `data/models/establishment.dart` 162–183 | address parts → one line | banner, sheet |
| `UNSCORED_IS_NOT_ZERO` | `data/models/inspection_log.dart` 33–47 | null rating ≠ 0 | "Scheduled" rows |
| `SANITARY_ORDER_FIELDS` | `data/models/inspection_log.dart` 47–65 | `so_*`, `deadline`, `received_by_name` | — |
| `PROPOSED_CONTACT` | `data/models/inspection_log.dart` 74–109 · `ui/screens/inspection_form_screen.dart` 63–69 | point-person name/email, written on every inspection (makes the owner account server-side) | form → "Point person" fields |
| `INSPECTION_LOG_MODEL_WRITE` | `data/models/inspection_log.dart` 164–201 | `toJson`; omits null optionals, never `email_sent_at` | — |
| `SANITARY_ORDER_WRITE` | `data/models/inspection_log.dart` 181–191 | SO keys omitted, never nulled (upsert safety) | — |

### Scoring, Sanitary Order rules, suggestions

| Anchor | Where | What | UI |
|---|---|---|---|
| `RATING_SCALE` | `core/rating_scale.dart` 3–117 | bands/labels/colours (contract with web); used at `history_screen.dart` 150, `home_screen.dart` 276, `inspection_details_screen.dart` 192, `inspection_form_screen.dart` 792–818 | every score badge |
| `SCORING_ENGINE` | `providers/rating_provider.dart` 79–88 | `totalDemerits` = Σ FAIL weights; score only when complete | live score header |
| `RATING_LABEL` | `providers/rating_provider.dart` 102–105 | band label for current score | live score header |
| `ANSWER_CLEARS_DEFECT_TEXT` | `providers/rating_provider.dart` 46–62 | leaving Fail clears note + correction | checklist card |
| `SO_DEFECT_SOURCE` | `core/sanitary_order.dart` 31–52 · `ui/screens/inspection_form_screen.dart` 569–602 | defects derived from the exact `results` rows to be stored | SO table |
| `SO_NUMBER_NORMALIZE` / `SO_CONTACT_NORMALIZE` | `core/sanitary_order.dart` 63–78 / 80–91 | blank → null, email lower-case | — |
| `SO_SUBMIT_GUARD` | `core/sanitary_order.dart` 112–158 | `firstBlocker`: note + correction per defect, time, deadline ≤ 365 d, received-by | Submit blocked with message |
| `CATEGORY_SUGGESTER` / `CATEGORY_SUGGESTER_RULES` | `core/category_suggester.dart` 1–351 / 92–265 | keyword → category from business name | picker hint |

### Home tab

| Anchor | Where | What | UI |
|---|---|---|---|
| `HOME_STATS` | `ui/screens/home_screen.dart` 122–165 | bento stat cards (establishments, pending, …) | Home top |
| `RECENT_ACTIVITY` | `ui/screens/home_screen.dart` 191–351 | latest inspections list | Home → "See All" |
| `STAT_CARD` | `ui/widgets/stat_card.dart` 4–72 | shared stat tile | Home |
| `NEW_INSPECTION_MODAL` | `ui/widgets/new_inspection_modal.dart` 8–241 | search establishments → open form | Home → "New Inspection" |
| `MODAL_ESTABLISHMENT_SEARCH` | `ui/widgets/new_inspection_modal.dart` 29–48 | debounced local search | same sheet |

### Establishments tab and map

| Anchor | Where | What | UI |
|---|---|---|---|
| `ESTABLISHMENT_LIST` | `ui/screens/establishments_screen.dart` 20–190 | search over name/owner/address, list | Establishments tab |
| `ESTABLISHMENT_SHEET` | `ui/widgets/establishment_sheet.dart` 12–28 | bottom sheet: details, "Inspection history", "Start new inspection" | tap a row / a map pin |
| `ESTABLISHMENT_DETAILS_CARD` | `ui/widgets/establishment_details_card.dart` 6–112 | masterlist fields card | inside the sheet |
| `FIELD_MAP` | `ui/screens/map_screen.dart` 12–339 | MapLibre basemap, GPS dot, one pin per located establishment | Map FAB → "My location", "Save map offline" |

### Inspection form (`/inspection`)

Layout: app bar (business name) → `EstablishmentBanner` → sticky score header → scrolling checklist (category picker,
items, Sanitary Order section, remarks) → bottom bar "Submit Inspection" (line 1284).

| Anchor | Where | What | UI |
|---|---|---|---|
| `SO_FORM_STATE` | `ui/screens/inspection_form_screen.dart` 57–62 | SO controllers (no., time given, received by) | SO section |
| `SO_ISSUE_TOGGLE` | `ui/screens/inspection_form_screen.dart` 71–84 | `_issueOrder` default ON when any Fail | SO section switch |
| `CATEGORY_SUGGESTION_SOURCE` | `ui/screens/inspection_form_screen.dart` 112–122 | suggestion from business name | picker hint |
| `BANNER_SCROLL_DENSITY` | `ui/screens/inspection_form_screen.dart` 127–149 | scroll → banner full/compact/minimal | banner shrinks while scrolling |
| `CATEGORY_SWITCH` | `ui/screens/inspection_form_screen.dart` 170–266 | load templates; confirm if answers would be lost | "Change checklist category?" → Keep current checklist / Switch and clear |
| `SO_FORM_SECTION` | `ui/screens/inspection_form_screen.dart` 268–401 | SO card: toggle, SO no., time given, deadline, received by, point person | below the checklist |
| `LIVE_SCORE_HEADER` | `ui/screens/inspection_form_screen.dart` 724–825 | pinned score + band + progress | under the banner |
| `CHECKLIST_RENDER` | `ui/screens/inspection_form_screen.dart` 827–923 | items grouped by sub-category | main list |
| `BANNER_KEYBOARD_YIELD` | `ui/screens/inspection_form_screen.dart` 1083–1105 | banner removed while keyboard open (clip guard) | — |
| `CATEGORY_PICKER_PLACEMENT` | `ui/screens/inspection_form_screen.dart` 1161–1185 | picker scrolls with the list, not pinned | top of the list |
| `ESTABLISHMENT_BANNER` / `BANNER_DENSITY` / `BANNER_DENSITY_THRESHOLDS` | `ui/widgets/establishment_banner.dart` 28–186 / 10–26 / 54–84 | identity strip and its 3 densities | top of form |
| `CATEGORY_PICKER` | `ui/widgets/category_picker.dart` 17–198 | filterable dropdown, disabled rows show reason | category field |
| `CATEGORY_PICKER_EMPTY` | `ui/widgets/category_picker.dart` 83–114 | never-synced device message | — |
| `CATEGORY_SUGGESTION_HINT` | `ui/widgets/category_picker.dart` 174–188 | "Suggested: … — matched …" | → "Use suggestion" |
| `SO_DEFECT_CAPTURE` | `ui/widgets/checklist_item_card.dart` 116–153 | note + correction fields revealed on Fail | each failed item |
| `PASS_FAIL_NA_CONTROL` | `ui/widgets/checklist_item_card.dart` 263–315 | segmented Pass / Fail / N/A | each item |

### Details, history, owner, profile

| Anchor | Where | What | UI |
|---|---|---|---|
| `INSPECTION_DETAILS_VIEW` | `ui/screens/inspection_details_screen.dart` 34–72 | fetch one log (local queue first) | History → tap a card |
| `SO_DETAILS_CARD` | `ui/screens/inspection_details_screen.dart` 285–371 | issued order: number, deadline, defects | details screen |
| `HISTORY_CARD` | `ui/screens/history_screen.dart` 122–260 | one log row: name, date, score band, synced state | History tab |
| `OWNER_HOME` | `ui/screens/owner_home_screen.dart` 13–506 | owner mode: deadline first, read-only logs, "Sign out" | owner sign-in lands here |
| `OWNER_CURRENT_ORDER` | `ui/screens/owner_home_screen.dart` 51–82 | pick the live order (latest with deadline) | banner at top |
| `PROFILE_SCREEN` | `ui/screens/profile_screen.dart` 10–422 | name edit, MFA reset, sync, sign out | Profile tab → Save / Reset Authenticator / Sign Out |
