# Inspectra — end-to-end flows, operations, history

Cross-cutting behaviour that spans mobile + database + web. File-level detail is in WEB.md, MOBILE.md, BACKEND.md.

## Actors

| Actor | Client | Role | Gets in by |
|---|---|---|---|
| CHO admin | web `/admin/*` | `admin` | invited/promoted by maintainer (`promote_admin.py`) or Access page; TOTP mandatory |
| Department head | web `/head/*` | `department_head` | promoted in Access page; read-only; TOTP optional |
| Field inspector | mobile | `officer` | self sign-up in app → email confirm → `pending` → admin sets `officer` in Access → TOTP enrol mandatory |
| Establishment owner / point person | mobile owner mode | `owner` | inspector records their email on an inspection → trigger grants → they sign in with email OTP (no password) |
| New account | either | `pending` | web shows AccountStatus "Waiting for activation"; mobile shows /pending-approval |

## 1. Inspector onboarding

1. Inspector taps Sign up in the mobile app → `auth.signUp` → Supabase sends Confirm-signup email (Brevo SMTP, plain-text link + code).
2. `handle_new_user()` trigger inserts `profiles(role='pending')`.
3. After confirming, the app pins them to `/pending-approval`. Web admin opens Access, sets role `officer`.
4. Inspector taps "Check again" → router → `/mfa-enroll` (mandatory TOTP) → `/sync` pulls categories, establishments, templates into Hive → `/home`.
Edge: if the inspector's email is also recorded as a point person somewhere, `profiles_point_person` trigger flips them to `owner` instead (known side effect).

## 2. Inspection lifecycle

1. **Mobile** picks establishment (search / list / map pin) → category → checklist (Pass/Fail/N/A + optional `fields`) → score computed
   `clamp(100 − Σ weights of Fail)` → optional Sanitary Order section when any Fail → point-person email (always shown).
2. Submit → `inspection_logs` upsert (RLS `is_authorized`). Offline/failure → `inspections_queue` in Hive; drained only when user taps Sync Now / Submit.
3. **DB**: `audit_inspection_logs` writes audit row. If `proposed_point_person_email` set → `inspection_logs_point_person` trigger →
   `grant_point_person` → copies email/name onto `establishments.point_person_*`, and if a profile with that email exists, makes it `owner` + `establishment_contacts` row.
4. **Web** sees it via realtime refetch: Inspections list ("Completed" if scored), Establishments/Masterlist latest-log columns, Dashboard KPIs,
   GIS barangay colour, Inspectors stats (matched by `inspector_name`), Audit trail sentence.
5. **Owner** (mobile owner mode) sees the log read-only with the SO deadline card.

Results JSON per item: `{checklist_item_id, item_name, sub_category, weight, answer:'Pass'|'Fail'|'NA', note, correction, values}`.
Web `answerKind()` maps pass/compliant → pass, fail/non-compliant → fail, else n/a.

## 3. Sanitary Order (form CHO-ESD-FR-04)

- Created only on mobile at submit time: `so_issued_at` (marker), `so_no` (free text, unique per Manila year), `time_given`, `deadline`, `received_by_name`.
  Defects = results with Fail, each needing note + correction. No signatures anywhere (removed 2026-11-06; columns/bucket kept, empty).
- Web `SanitaryOrderView` renders it inside the log detail (Inspections dialog or Establishment history); Print/Save as PDF via `window.print()`.
- "Email copy" (web, admin UI; function allows admin|officer) → edge function `send-sanitary-order` → Brevo API → `inspection_logs.email_sent_at`.
  409 if already sent unless `resend:true`. Recipient = `establishments.point_person_email`. The UPDATE lands in audit_log attributed to the caller.
- Owner mobile home shows deadline countdown (amber ≤3 d, red overdue).

## 4. Owner (point person) access — automatic since 2026-11-07

- Any of: inspection with `proposed_point_person_email`, web Add/Edit establishment setting `point_person_email`, or a new profile whose email matches →
  `grant_point_person`: rejects staff roles; `pending` → `owner`; upsert `establishment_contacts`.
- Owner signs in on mobile "Owner sign in" → `signInWithOtp(shouldCreateUser:true)` → 6-digit code from the Magic Link/OTP template (or Confirm-signup template
  on very first sign-in) → `verifyOTP` → profile created `pending` → `profiles_point_person` trigger grants → app `ensureRole()` sees `owner` → `/my/inspections`.
  If no establishment names that email, role stays `pending` and the dialog says "no establishment registered".
- RLS: owner reads only granted establishments + their logs; no writes, no storage.
- Revocation: there is no UI; clearing `point_person_email` does not delete the `establishment_contacts` row (maintainer deletes it by SQL).
- The older manual path (web Access approval queue + `provision-owner` function + `owner_access_rejections`) is removed/unused.

## 5. Authentication details

- Roles come from `profiles.role` on every client; never from JWT claims.
- MFA (TOTP via Supabase `mfa.*`): mandatory for mobile staff roles and web admins; optional for department_head; owners never.
  `mfa_satisfied()` RLS gate: AAL2 passes; enrolled-but-AAL1 fails; unenrolled non-admin passes; unenrolled admin fails (except reading own profile row).
- Sign-in loop bug (fixed in b5): gotrue `listFactors()` triggers `tokenRefreshed`, which re-entered the mobile auth listener → 429 → sign-out. Mobile now ignores `tokenRefreshed`.
- Password reset: requested from mobile "Forgot Password?" → Reset-password template → web `/reset-password?token_hash&type=recovery` → `verifyOtp` → TOTP if enrolled → `updateUser`. Web has no forgot-password link itself.
- Invites: Invite template → `/reset-password?type=invite`.
- Emails: Brevo SMTP for Auth mail (OTP, confirm, reset) and Brevo HTTP API for Sanitary Orders. Templates use plain-text links because Brevo click tracking rewrites `<a>` hrefs to a host that times out.
- Google OAuth: web client exists in Supabase config, but no client uses it (web has no button; mobile removed it). Android OAuth client was never created.

## 6. Masterlist import (web, admin)

Yearly BPLO business-permit workbook (food / non-food sheets) → parse → match against existing establishments by permit no. and by
name+street+barangay → renewal / update-permit / create / review → bulk upserts to `establishments` + `establishment_permits`, ambiguous rows to
`review_queue`, run record in `upload_batches`, "missing from file" list (establishments not seen this year). Import never sets category or
inspection data; it revives delisted records it sees. Details in WEB.md → MasterlistImport.

## 7. AI compliance report (web, both roles)

Dashboard button → BarangaySummaryDialog: date range (default last 90 Manila days, max 366) + barangay checkboxes → local preview →
Confirm → edge function `generate-barangay-summary` (Anthropic `claude-opus-5`, JSON schema) → client jsPDF A4 executive report
(`Inspectra_Compliance_Report_{from}_to_{to}.pdf`) → `logEvent("REPORT")`. Function has no role check; RLS scopes data. Real generation untested as of 2026-11-06.

## 8. Audit trail

`audit_log` filled by `audit_row()` triggers on 9 tables (skips no-op updates) + `log_event()` RPC for SIGN_IN / EXPORT / REPORT from web.
Admin-only read, nobody can write/delete through the API. Web Audit page renders plain sentences + before/after and exports Excel (cap 5000).
Not captured: failed sign-ins, mobile sign-ins, department_head read access.

## 9. Map / GIS

- Web: Leaflet + OSM tiles; 105 PSGC polygons coloured by worst band of latest logs; pins from `latitude/longitude`.
- Mobile: MapLibre + OpenFreeMap liberty style (keyless), offline region download for Batangas City bbox, GPS dot, red pins from Hive, tap → sheet → start inspection.
- Coordinates: 109 `OSM_SEED` demo rows (from OpenStreetMap Overpass, fast food/areas in Alangilan, Balagtas, Poblacion) + 48 real rows that were matched/merged.
  Real-record coordinates otherwise come from the mobile "Pin GPS location here" button (queued, drained on sync). Delete demo rows with
  `delete from establishments where masterlist_sheet='OSM_SEED'`. Paid map APIs were ruled out (decision 2026-11-05).

## 10. Release & deployment summary

| Piece | How it ships |
|---|---|
| Web | push `main` of inspectra-web → Render auto-deploy → www.inspectra-cho.com. Headers/env manual in Render dashboard. |
| Mobile | `.\release.ps1 "notes"` → split APKs + `update.json` → GitHub release in public `josiahcustodio/inspectra-releases` → devices prompt on Wi-Fi. Commit pubspec after. |
| DB schema | maintainer runs `python migration/apply_sql.py NN_x.sql` with a fresh Supabase PAT (Management API), then `notify pgrst, 'reload schema'`. SQL lives outside the repos. |
| Edge functions | `npx -y supabase@2 functions deploy <name> --project-ref fwtgdgeiffnvqyrobixc --yes` with `SUPABASE_ACCESS_TOKEN`. Secrets: BREVO_API_KEY, SANITARY_ORDER_FROM, ANTHROPIC_API_KEY. |
| Auth templates/config | Management API `PATCH /config/auth` from `supabase/templates/`. |
| Checklist content | `migration/seed_checklists_2026_11.py` (323 templates / 17 categories live 2026-11-05). |

## 11. Timeline (what happened when)

- 2026-09: Firebase era (Firestore + Firebase Auth); `docs/ARCH_GUIDE.md`, `docs/code-walkthrough/` describe this and are now historical.
- 2026-10-06: migrated to Supabase (9263 rows). 2026-10-11: web live on Supabase; Firebase frozen (deny-all rules), deletion planned ~2026-11-10.
- 2026-10-10/11: ZAP scan triaged; CSP + security headers live in Render dashboard.
- 2026-10-23 → 11-05: Sanitary Order feature, owner role, `pending` default role (closed self-signup-as-officer hole), Brevo email, SQL 04–07.
- 2026-11-05: department_head role + audit trail (SQL 08–09); web `/head` routes, `/signup` removed; checklist update (fields + categories 18–24);
  GIS pins + OSM seed; password reset page live; large QA run (see §12).
- 2026-11-06: AI executive PDF; signatures removed everywhere; APK self-update built; b4 published.
- 2026-11-07: auto owner approval (SQL 10); admin MFA required (SQL 11); mobile nav rework (map FAB, profile tab, QR removed, GPS pin).
- 2026-11-08: audit logbook rewrite + `log_event` (SQL 12); b5 published; `grant_point_person` EXECUTE revoked.

## 12. Open issues (2026-11-08)

- Mobile: b5 device test pending (update prompt b4→b5, GPS pin, map sheet, owner OTP dialog). Enrolled officer on a fresh install could dead-end on
  `/sync` when the AAL1 profile read returns null (router order fix reported applied, unverified on device). Home "Recent Activity" may stay empty after a submit.
- Web: Inspections detail SO blank name/address; Inspectors undated-log period bug; owner home shows UTC date; no 404; tab title.
- Backend: `01/02_*.sql` rebuild scripts stale vs live (missing SQL 10–12); `provision-owner` + `owner_access_rejections` unused; signature columns/bucket kept until all devices ≥ b4;
  Brevo authorized-IP fragility (Supabase egress 52.74.233.1); second admin `noniekinyo@gmail.com` not MFA-enrolled; `testuser@gmail.com` auth user with no profile row.
- Data: duplicate category "Food" (ids 1 and 9); categories 17/23/24 weight 0 until CHO supplies weights; OSM_SEED demo rows still live.
- Process: Supabase PATs are revoked after each use (assume `migration/.env` PAT is dead); Firebase project deletion due ~2026-11-10.
