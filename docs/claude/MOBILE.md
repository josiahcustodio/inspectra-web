# Inspectra mobile — Flutter inspector app reference

Repo `josiahcustodio/inspectra-mobile` (private). Local folder name is `clowtec_inspector` ("Clowtec" was the old
codename; same product). Package `com.clowtec.inspector`, app label "Inspectra". Android only in practice
(APK side-loaded, not on Play Store). Dart `>=3.0 <4.0`, Flutter `>=3.44`, `compileSdk 37`, Java 17.
State as of 2026-11-08: pubspec `version: 1.0.0+5`, last published `v1.0.0-b5`.

Stack: `supabase_flutter 2.x`, `provider ^6.1.2` (ChangeNotifier, no Riverpod), `go_router`, `hive_flutter`
(offline cache), `maplibre_gl ^0.28` (map), `geolocator` + `permission_handler` (GPS pin), `ota_update` (self-update),
`qr_flutter` (only for the MFA QR), `connectivity_plus`. No Firebase, no camera, no signature pad, no QR scanner anymore.

## File map (`lib/`)

| Path | Purpose |
|---|---|
| `main.dart` | `Supabase.initialize` (`core/supabase_config.dart`), `Hive.initFlutter`, `OfflineService.init`, `MultiProvider` (4 providers), `createAppRouter`, `UpdateGate` wraps `MaterialApp.router` |
| `core/supabase_config.dart` | project URL + publishable key constants |
| `core/router/app_router.dart` | go_router, redirect guard chain (below), `StatefulShellRoute` with 5 branches |
| `core/app_updater.dart` | OTA self-update: manifest fetch, compare, `UpdateGate` dialog |
| `core/rating_scale.dart` | rating bands (shared contract with web `src/lib/ratingScale.ts`) |
| `core/sanitary_order.dart` | Sanitary Order validation (`firstBlocker`), normalisers |
| `core/category_suggester.dart` | keyword → category suggestion from business name |
| `data/models/establishment.dart` | Hive typeId 0, fields 0–22 (incl. 21 latitude, 22 longitude; 13 qrCodeId legacy) |
| `data/models/checklist_template.dart` | Hive typeId 1 + `ChecklistField{label,type,options}` |
| `data/models/inspection_category.dart` | Hive typeId 2 + `CategoryOption` / `CategoryUnavailableReason` |
| `data/models/inspection_log.dart` | plain Dart, `toJson` omits null optional keys, never writes `email_sent_at` |
| `data/services/auth_service.dart` | sign in/up, `fetchRole()` (reads `profiles.role`, caches in Hive `app_prefs` `role:<uid>`), OTP, reset |
| `data/services/mfa_service.dart` | TOTP enroll/challenge/verify/unenroll, `needsAal2Upgrade`, `hasTotpEnrolled` |
| `data/services/offline_service.dart` | Hive boxes, `syncData()` master-data pull (1000/page), GPS pin queue + drain |
| `data/services/sync_service.dart` | `inspection_logs` upsert / history (limit 50) / details / by-establishment, queue drain |
| `providers/auth_provider.dart` | auth state listener (ignores `tokenRefreshed` — loop guard), role, MFA flags |
| `providers/rating_provider.dart` | answers, notes, corrections, values, weights → demerits/score/band |
| `providers/pending_inspections_provider.dart` | queue count, Sync Now / Submit All / Submit one, `lastSyncedAt` |
| `providers/inspection_history_provider.dart` | history logs (staff + owner), generation counter against post-signout races |
| `ui/screens/` | login, splash_sync, verify_email, mfa_enroll, mfa_verify, pending_approval, main_navigation (shell), home, establishments, history, profile, map, inspection_form, inspection_details, owner_home |
| `ui/widgets/` | new_inspection_modal, category_picker, checklist_item_card, establishment_sheet, establishment_banner, establishment details card, pending_card, stat_card |
| `test/` | 12 files: updater, category availability/suggester, checklist fields, details card, withLocation, history provider, inspection_log json, owner OTP dialog, rating scale, sanitary order, placeholder widget_test |

`bin/*.py` = old Firestore admin scripts (dead). `firebase.json`, `firestore.rules`, `storage.rules`, `firestore-tests/`,
`firebase_migration_plan.md`, `MOBILE_REWORK_PLAN.md`, `web-dashboard/` (gitignored) are leftovers; ignore them.
`README.md` is stale (still describes QR scanner, signatures, photo evidence).

## Supabase surface used by the app

No RPCs, no Edge Function calls, no Storage. Tables:
- `profiles` select role (auth_service)
- `categories`, `establishments`, `checklist_templates` paged select ordered by id (offline_service `_fetchAllRows`)
- `establishments.update({latitude, longitude})` pin drain (offline_service); `select id, business_name in (...)` name lookup (sync_service)
- `inspection_logs` upsert; select limit 50 by `inspection_date desc` (RLS scopes it, no inspector filter); `eq establishment_id`; `eq id maybeSingle`; background `update establishment_name` backfill (sync_service)
Auth: signInWithPassword, signUp (`data: {display_name}`), resend, getUser, resetPasswordForEmail, signInWithOtp (`shouldCreateUser: true`), verifyOTP (`OtpType.email`), updateUser, signOut, mfa.*.
Google sign-in removed (commit 0dc07ee).

## Startup, auth and routing

Initial route `/sync`. `AuthProvider` listens to `onAuthStateChange`, **ignores `tokenRefreshed`** (otherwise `listFactors()`
→ refresh → re-enter → 429 → signed out; this was the Oct-2026 sign-in loop bug). On session: `needsAal2`, `hasTotpEnrolled`, `fetchRole`.

Router redirect order (`app_router.dart`):
1. no session → `/login`
2. role unknown → `/mfa-verify` if a challenge is pending, else pinned to `/sync` (splash shows "Could not confirm your account" with Retry/Sign out when role is null)
3. `pending` → `/pending-approval` ("Check again" calls `refreshRole`; Sign out)
4. `owner` → only `/my/...` and `/inspection/details/*`; everything else → `/my/inspections`; owners skip MFA, email verification and sync
5. AAL1 with factor enrolled → `/mfa-verify`
6. email unconfirmed → `/verify-email` (polls `getUser()` every 4 s)
7. MFA status unknown → `/sync`
8. no TOTP factor → `/mfa-enroll` (**mandatory for every staff role**)
Then splash runs `OfflineService.syncData()` and goes `/home`.

`officer`, `admin`, `department_head` all get the same inspector UI (only the Profile role label differs). RLS still blocks
department_head writes, so their submits fail server-side. No "disabled" state beyond the `user_banned` sign-in error.

Login screen: email/password; Sign-up dialog (creates `pending` account, must confirm email, then wait for admin promotion);
"Forgot Password?" → `resetPasswordForEmail` (reset itself completes on the web `/reset-password` page);
"Owner sign in" dialog → email OTP; after verify, `ensureRole()`; any role other than `owner` is signed out with a message,
a `pending` result shows "no establishment registered".
Profile: Full name (`updateUser` metadata `display_name` → becomes `inspector_name`), Reset Authenticator (unenroll all TOTP → forced re-enroll), Help/FAQ, Sign out.

## Navigation

Shell `MainNavigationScreen` (`StatefulShellRoute.indexedStack`): branches 0 `/home`, 1 `/establishments`, 2 `/history`,
3 `/profile`, 4 `/map`. Bottom bar: Home, Establishments, gap, History, Profile. Centre-docked FAB opens the Map.
Other routes: `/login`, `/sync`, `/verify-email`, `/mfa-enroll`, `/mfa-verify`, `/pending-approval`, `/my/inspections`
(OwnerHomeScreen), `/inspection` (InspectionFormScreen, `extra: Establishment`), `/inspection/details/:id` (`extra: establishmentName`).
The app **cannot add or edit establishments** (web only). Known nit: `tabNotifier` is a ValueNotifier, so "See All" → History works once per value change.

## Offline model (Hive only)

Boxes: `establishments`, `checklist_templates`, `categories` (master data, rebuilt if unreadable), `inspections_queue`
(`Box<String>` JSON keyed by log id), `app_prefs` (`role:<uid>`, `last_synced_at`, `pin:<id>` queued GPS pins).
`syncData()` (splash, staff roles only): categories → drain pins → establishments (skips rows with status set and not
`'active'`; preserves stranded local-only rows) → templates. Each batch fully parsed before the box is replaced;
an empty server snapshot never wipes the cache (`EMPTY_SNAPSHOT_GUARD`).
Queue drain is **manual only** (Sync Now / Submit All / per-item Submit); nothing drains on startup or connectivity change.
Conflict policy: last-write-wins upsert on `id`. Legacy ids containing `_` get a fresh uuid before upsert.
Pin drain keeps the pin on 5xx/429/`PGRST30*`, drops it on other server errors.

## Inspection flow

1. Choose establishment: Home "New Inspection" modal (Hive search by name/id, top 5), Establishments list, or map sheet "Start new inspection".
2. Category picker (`DropdownMenu`, sorted sort_order → name → id). Disabled with reason when no templates on device or all weights 0
   (Livestock 17, Industrial 23, Waste Management 24). `CategorySuggester` proposes one from the business name (never preselected).
   Templates resolve by `category_id` (name fallback only if no template has an id). Switching category after answering confirms and clears.
3. Checklist grouped by `sub_category`; each item PASS / FAIL / N/A. N/A hidden when sub_category contains "water" or "waste".
   `fields` render extra inputs (text/number/date/yesno/choice/multi) → `results[].values` keyed by label.
   FAIL reveals defect note + correction; any other answer clears them.
4. Scoring (`rating_provider.dart`): `totalDemerits` = Σ weight of FAIL items (missing weight = 5);
   `score = clamp(100 − totalDemerits, 0, 100)` only when every item is answered, else null ("Not Scored Yet"). N/A costs nothing.
   Bands: 90–100 Excellent `#10B981`; 70–89 Very Satisfactory `#F59E0B`; 0–69 Satisfactory `#EF4444`. No separate high-risk flag in mobile.
5. Sanitary Order section appears when ≥1 FAIL: toggle "Issue a Sanitary Order" (default on), SO No. (optional free text),
   time given, deadline (today..+365d), received by. `SanitaryOrder.firstBlocker` requires note+correction on every defect, time given, deadline, received-by.
   Point-person email field is shown on every inspection (shape-validated).
6. Submit guard order: no categories → no category → not selectable → no templates → incomplete checklist → email shape → order blocker.
7. Write: one `inspection_logs` upsert. `results[] = {checklist_item_id, item_name, sub_category, weight, answer:'Pass'|'Fail'|'NA', note, correction, values}`;
   `remarks` = free text + appended "Deficiencies:" list; `inspector_name` = displayName ?? email ?? 'Inspector';
   `so_issued_at` only when an order is issued; `proposed_point_person_name` = received-by (only with an order);
   `proposed_point_person_email` on every inspection (this is what triggers owner access server-side). On failure → `inspections_queue`.
8. History: server rows (limit 50) merged with queue, de-duped by id. Details are server-only (queued log → snackbar).
   Details screen: rating, demerits, remarks, SO card with overdue flag, results grouped by sub_category.

GPS pin ("Pin GPS location here" on the form): `geolocator` best accuracy, 25 s limit, confirms if accuracy > 100 m or when replacing
an existing pin; writes Hive immediately, queues `pin:<id>`, drained on next sync to `establishments.latitude/longitude`.
GPS is **not** attached to inspection rows.

## Map (`ui/screens/map_screen.dart`)

MapLibre with `MapLibreStyles.openfreemapLiberty` (free, keyless). Centre `13.76, 121.055` zoom 12. "Save offline" downloads
SW `13.68,120.98` → NE `13.88,121.16`, zoom 10–15. GPS dot in compass mode. Red circle pins for every Hive establishment with
lat/lng (OSM_SEED demo rows are not filtered). Search box flies to top-8 match. Tap pin → `showEstablishmentSheet`
(queued + server logs, "Start new inspection"). Small "my location" FAB.

## Owner mode (`ui/screens/owner_home_screen.dart`, `/my/inspections`)

Read-only, server rows only (`fetchOwnerHistory`). Deadline card when latest log has `so_issued_at` + `deadline`
(amber ≤3 days, red overdue), list of log cards with score/band/SO badge, pull-to-refresh, Sign out.
Owner accounts are created by the server triggers (see BACKEND.md §3), never by the app.

## Release and self-update

Publish **only** with `.\release.ps1 "What changed"` (repo root):
1. reads `version: X.Y.Z+N`, build = N+1, tag `vX.Y.Z-b<N+1>`
2. `flutter build apk --release --split-per-abi --target-platform android-arm,android-arm64 --build-number=$build --dart-define=APP_BUILD=$build`
3. copies `inspectra-arm64-v8a.apk` (~38 MB) and `inspectra-armeabi-v7a.apk` (~31 MB) to `build/release-upload/`
4. writes `update.json` `{build, version, notes, apks:{<abi>:{url, sha256, megabytes}}}`
5. `gh release create <tag> ... -R josiahcustodio/inspectra-releases --latest` (public, APK-only repo)
6. only then bumps `pubspec.yaml` build number → **commit pubspec afterwards**.

`app_updater.dart`: manifest `https://github.com/josiahcustodio/inspectra-releases/releases/latest/download/update.json`;
current build = `int.fromEnvironment('APP_BUILD')` (0 in debug/plain builds = updater off); Android only; checks at startup,
connectivity change, app resume; Wi-Fi only, 15 s timeout; integer compare `manifest.build > current` and ABI must exist;
`UpdateGate` overlays a dialog (Later = snooze for session / Update → `OtaUpdate().execute(url, sha256)` → system installer).
Signing: `android/key.properties` + `android/app/release.keystore` (both gitignored; alias `upload`). **Losing the keystore ends in-place updates.**
A plain `flutter build apk` has a lower versionCode than split builds, so Android refuses it as a downgrade over a split install.
Never `flutter clean` on the maintainer's machine if an undistributed APK sits in `build/`.
