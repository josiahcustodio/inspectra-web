# Inspectra backend — Supabase reference

Project ref `fwtgdgeiffnvqyrobixc` (`https://fwtgdgeiffnvqyrobixc.supabase.co`), region Singapore.
Everything below is the **live state as of 2026-11-08** after SQL files 00→12 were applied.
The SQL itself lives in the maintainer's untracked `migration/sql/` folder (not in any repo),
so this file is the schema's documentation of record. Do not invent columns that are not here.

Authorization is Postgres RLS, not client code. Both clients talk to Supabase directly with the
publishable (anon) key; there is no custom API server. Privileged work happens in three Edge
Functions (Deno) under `supabase/functions/`.

## 1. Roles

Enum `public.app_role` = `officer | admin | pending | owner | department_head`.
A user's role is `profiles.role`, read live by `user_role()` (uses `auth.uid()`); JWT claims
are never used for roles. The JWT is only read for `aal` by `mfa_satisfied()`.

| Role | Who | Can |
|---|---|---|
| `pending` | every new auth user (trigger `handle_new_user`) | nothing except read own profile row |
| `officer` | field inspector (mobile) | read all staff data, insert/update establishments, permits, inspection_logs, upload evidence |
| `admin` | CHO office admin (web) | everything, plus profiles, reference data, imports, audit_log, deletes. **Must have TOTP enrolled and be at AAL2.** |
| `department_head` | read-only web viewer | read what staff read, write nothing; cannot read `upload_batches`, `review_queue`, `audit_log` |
| `owner` | establishment point person (mobile, OTP sign-in) | SELECT only on their establishments (via `establishment_contacts`) and those establishments' inspection_logs |

Helper functions (all `security definer`, `search_path = public`):
`user_role()`, `is_admin()`, `is_authorized()` = admin|officer (**the writer gate; never add department_head**),
`can_read()` = admin|officer|department_head (**the reader gate**), `owns_establishment(est uuid)`,
`mfa_enrolled()`, `mfa_satisfied()`.

`mfa_satisfied()`: true if JWT `aal = 'aal2'`; else false if a verified factor exists; else true
unless role is `admin`. Net effect: an admin always needs AAL2; other roles without a factor pass
at AAL1. Every table and `storage.objects` has a **restrictive** `<table>_mfa` policy that ANDs
`mfa_satisfied()` with the permissive policies. Exception: `profiles_mfa` also lets an
**unenrolled** user read their own row, so a factor-less admin can learn its role and be sent to
enrolment. An enrolled admin at AAL1 reads nothing (not even its own profile).

Lesson learned 2026-11-08: every new `security definer` function in `public` needs
`revoke execute ... from public, anon, authenticated` unless it is meant as an RPC
(`grant_point_person` was callable by anyone over `/rest/v1/rpc` until revoked).

## 2. Tables (`public`)

No views exist. No `anon` policies exist (anonymous = denied everywhere).

### profiles
| column | type | notes |
|---|---|---|
| id | uuid | PK, FK auth.users(id) on delete cascade |
| role | app_role | not null, default `'pending'` |
| email | text | |
| created_at | timestamptz | not null default now() |

RLS: SELECT own row or admin; INSERT nobody (only trigger/service role); UPDATE/DELETE admin.

### categories
| column | type | notes |
|---|---|---|
| id | text | PK, legacy ints as text ('1'..'24') |
| name | text | not null |
| sort_order | int | |
| icon_name | text | |
| sheet_aliases | jsonb | not null default '[]' (masterlist sheet names mapping to this category) |
| created_at | timestamptz | |

Known data quirk: ids '1' and '9' are both named "Food"; '9' has no templates.
Categories 17 (Livestock), 23 (Industrial), 24 (Waste Management) have all weights 0 → disabled in the picker until CHO supplies weights.

### checklist_templates
| column | type | notes |
|---|---|---|
| id | text | PK |
| category_id | text | no FK on purpose |
| category | text | |
| category_name | text | |
| sub_category | text | |
| item_name | text | |
| item | text | legacy alternate name |
| weight | numeric | demerit weight |
| fields | jsonb | not null default '[]'; `[{label, type: text|number|date|yesno|choice|multi, options}]` extra inputs per item; answers stored in `inspection_logs.results[].values` keyed by label |

Index `checklist_templates_category_id_idx`. Live: 323 templates / 17 categories / 53 with fields (2026-11-05 seed).

### establishments
| column | type | notes |
|---|---|---|
| id | uuid | PK, no default (client generates) |
| business_name | text | not null default '' |
| owner_name | text | |
| address | jsonb | string **or** object (legacy mix) |
| barangay | text | |
| qr_code_id | text | legacy (QR feature removed) |
| personnel_count | int | |
| personnel_with_hc | int | personnel with health certificate |
| sanitary_permit_no | text | |
| control_no | text | |
| category_id / category / category_name | text | |
| latitude / longitude | double precision | map pins; mobile GPS pin capture |
| business_permit_no | text | |
| applic_type | text | |
| permit_date_issued | text | |
| line_of_business | text | |
| floor_area_sqm | numeric | |
| tel_no | text | |
| tin | text | |
| "group" | text | `'food'` or `'non_food'` |
| masterlist_sheet | text | source sheet; `'OSM_SEED'` = demo rows seeded from OpenStreetMap (109 rows live) |
| import_date_inspected / import_sssr / import_remarks | text | raw masterlist columns |
| status | text | `'active'` or `'delisted'`; NULL treated as active |
| source_batch_id / last_seen_batch_id | uuid | masterlist import batches |
| point_person_name / point_person_email | text | the owner contact; setting email triggers owner grant |
| created_at / updated_at | timestamptz | |

Indexes on status, "group", barangay. No CHECK constraints.
RLS: SELECT `can_read()` OR (role owner AND `owns_establishment(id)`); INSERT/UPDATE `is_authorized()`; DELETE admin.

### establishment_permits
`establishment_id uuid` (FK establishments, cascade) + `permit_no text` = PK; `data jsonb` not null '{}';
`source_batch_id uuid`; `imported_at timestamptz`. RLS: read can_read, write is_authorized, delete admin.

### inspection_logs
| column | type | notes |
|---|---|---|
| id | uuid | PK, no default |
| establishment_id | uuid | **no FK on purpose** |
| establishment_name | text | denormalised |
| category_id / category_name | text | |
| inspector_name | text | free text, not linked to a user |
| total_demerits | int | |
| percentage_rating | double precision | |
| remarks | text | |
| inspection_date | timestamptz | |
| photo_evidence_url | text | signed URL in `inspection_evidence` bucket |
| signature_url / signature_sha256 | text | **dead** since 2026-11-06 (signatures removed); columns kept |
| so_no | text | Sanitary Order number (free text; CHO pattern unknown) |
| so_issued_at | timestamptz | non-null = an order exists |
| time_given | text | compliance period text |
| deadline | date | |
| received_by_name | text | |
| received_signature_url / received_signature_sha256 | text | dead, kept |
| email_sent_at | timestamptz | set only by `send-sanitary-order` |
| proposed_point_person_name / proposed_point_person_email | text | inspector-recorded owner contact; triggers owner grant |
| results | jsonb | not null '[]'; per checklist item answer (see FLOWS.md §Inspection) |

Indexes: date desc; establishment_id; **unique** `(so_no, year(so_issued_at Asia/Manila)) where so_no not null`;
so_issued_at desc partial; undelivered partial (`so_issued_at not null and email_sent_at is null`); proposed-contact partial.
RLS: SELECT can_read OR (owner AND owns_establishment(establishment_id)); INSERT/UPDATE is_authorized; DELETE admin.

### upload_batches (masterlist import runs)
`id uuid PK`, `file_name text`, `"group" text`, `uploaded_by text`, `status text`, `started_at`, `finished_at timestamptz`,
`error text`, `counters jsonb '{}'`, `missing_establishment_ids jsonb '[]'`. RLS: admin SELECT/INSERT/UPDATE; DELETE nobody.

### review_queue (ambiguous import rows awaiting a human)
`id text PK ('rq-<hash>')`, `batch_id uuid`, `"group" text`, `status text`, `created_at`, `decided_at timestamptz`,
`sheet_name text`, `row_number int`, `category_id text` (legacy, unread), `row jsonb '{}'`, `candidates jsonb '[]'`,
`resolved_establishment_id uuid`. RLS: admin for all.

### inspectors (display roster, not auth)
`id text PK`, `name`, `inspector_id`, `email`, `phone`, `status`, `performance text`, `total_inspections int`,
`completed_today int`, `updated_at timestamptz`. RLS: read can_read; write admin.

### establishment_contacts (owner grants)
`user_id uuid` (FK auth.users cascade) + `establishment_id uuid` (FK establishments cascade) = PK; `granted_by uuid` (FK auth.users);
`granted_at timestamptz default now()`. RLS: SELECT own rows or can_read; write admin.
Clearing `establishments.point_person_email` does **not** delete the grant.

### owner_access_rejections
`inspection_log_id uuid PK` (no FK), `decided_by uuid`, `decided_at`, `reason text`. **Unused** since auto-owner approval (SQL 10); kept.

### audit_log
| column | type | notes |
|---|---|---|
| id | bigint | identity PK |
| at | timestamptz | default now() |
| actor_id | uuid | |
| actor_email / actor_role | text | copied from profiles at write time |
| table_name | text | not null; `'events'` for log_event rows |
| row_id | text | not null |
| row_label | text | business_name / establishment_name / name / email / permit_no |
| action | text | CHECK in `INSERT, UPDATE, DELETE, SIGN_IN, EXPORT, REPORT` |
| changed_fields | text[] | default '{}' |
| old_row / new_row | jsonb | |

Grants: `authenticated` has SELECT only (INSERT/UPDATE/DELETE/TRUNCATE revoked). RLS SELECT: `is_admin()` + MFA.
Only the service key can delete audit rows.

Realtime publication `supabase_realtime` includes: profiles, categories, checklist_templates, establishments,
inspection_logs, inspectors, review_queue, upload_batches (not permits, contacts, rejections, audit_log).

## 3. Triggers

| Trigger | Table / event | Does |
|---|---|---|
| `on_auth_user_created` | auth.users AFTER INSERT | `handle_new_user()` inserts `profiles(id,'pending',email)`; ignores user metadata |
| `audit_*` (9) | inspection_logs, establishments, establishment_permits, establishment_contacts, owner_access_rejections, profiles, inspectors, checklist_templates, categories — AFTER INSERT/UPDATE/DELETE | `audit_row()`: one audit_log row; UPDATE with no changed fields is skipped (mobile re-upserts on sync); actor = auth.uid(), or header `x-audit-actor` when service_role |
| `inspection_logs_point_person` | inspection_logs AFTER INSERT OR UPDATE OF proposed_point_person_email | `grant_point_person(establishment_id, proposed email)`; if true copies email+name onto establishments.point_person_* |
| `establishments_point_person` | establishments AFTER INSERT OR UPDATE OF point_person_email | `grant_point_person(id, point_person_email)` |
| `profiles_point_person` | profiles AFTER INSERT | grants every establishment whose point_person_email matches the new user's email |

`grant_point_person(est, addr)` (security definer, EXECUTE revoked from anon/authenticated): lowercases/trims,
rejects null est, malformed email, or staff profiles (admin/officer/department_head). No profile yet → returns true
(grant happens later at first OTP sign-in via `profiles_point_person`). Profile exists → `pending`→`owner`, upsert
`establishment_contacts`. Side effect: a self-signed-up `pending` inspector whose email is named as a point person becomes `owner`.

`log_event(kind text, label text)` RPC (granted to `authenticated`): kind ∈ SIGN_IN|EXPORT|REPORT; inserts audit_log with
`table_name='events'`, `row_id=kind`, `row_label=left(label,200)`. Called from web `src/lib/auditEvents.ts`.
Not captured anywhere: failed sign-ins, mobile sign-ins.

## 4. Storage

Both buckets private; stored URLs are 10-year signed URLs. Created via Storage API in `apply_phase1.py`, not SQL.

| Bucket | Limit / mime | Path | Policies |
|---|---|---|---|
| `inspection_evidence` | 5 MB; jpeg/png/webp/heic | `{establishmentId}/{ts}.jpg` | insert is_authorized; select can_read; update/delete admin; `storage_mfa` restrictive |
| `signatures` | 200 KB; png | `{establishmentId}/{logId}.png` | insert/update is_authorized; select can_read; **no delete policy**. Bucket emptied 2026-11-06, feature dead |

Owners and pending users have no storage access.

## 5. Auth configuration (dashboard / Management API, not SQL)

- Email confirmation required (`mailer_autoconfirm=false`); TOTP MFA enroll+verify enabled.
- `site_url = https://www.inspectra-cho.com`; allow list adds `https://inspectra-web.onrender.com/**` and `http://localhost:5173/**`.
- Sign-ups stay enabled: mobile inspector onboarding is self-signup → `pending` → admin promotes in web Access page.
- Google OAuth: web client enabled (GCP project `cityhealth-492614`); Android OAuth client never created, so device Google sign-in is not working.
- SMTP: Brevo `smtp-relay.brevo.com:587`, OTP length 6, subject "Your Inspectra login code", rate 60/h. Brevo "Authorized IPs" is ON with Supabase egress `52.74.233.1` whitelisted; if Supabase egress changes, OTP emails fail with `525 5.7.1 Unauthorized IP address` (fix in Brevo Settings → Security → Authorized IPs).
- Email templates in `supabase/templates/` (pushed via Management API `PATCH /config/auth`). Links are **plain text, not `<a>` tags**, because Brevo click tracking cannot be disabled and its redirect host times out:
  - `confirm-signup.html` → Confirm signup; shows `{{ .ConfirmationURL }}` text and a `{{ .Token }}` code box (owner first OTP sign-in).
  - `invite.html` → Invite user; `{{ .SiteURL }}/reset-password?token_hash={{ .TokenHash }}&type=invite`.
  - `login-otp.html` → Magic Link/OTP; `{{ .Token }}` only.
  - `reset-password.html` → Reset password; `{{ .SiteURL }}/reset-password?token_hash=...&type=recovery`.

## 6. Edge Functions (`supabase/functions/*/index.ts`, Deno)

All: POST + OPTIONS (CORS `*`), 405 otherwise, verify caller JWT with `auth.getUser()` → 401 if absent, errors → `500 {error}`.
Deploy: `npx -y supabase@2 functions deploy <name> --project-ref fwtgdgeiffnvqyrobixc --yes` with `SUPABASE_ACCESS_TOKEN` set.

### send-sanitary-order — LIVE, used by web `SanitaryOrderView.tsx`
Body `{logId, resend?}` → `{sent:true, to, emailSentAt}`. Runs under the **caller's JWT only** (so RLS applies and the audit
trigger attributes the `email_sent_at` UPDATE to the officer/admin). Role must be admin|officer (403). 404 log missing;
422 no `so_issued_at`, no establishment, or empty `point_person_email`; 409 already sent unless `resend:true`.
Renders HTML via `render.ts`, sends through Brevo HTTP API `POST https://api.brevo.com/v3/smtp/email`, then sets
`inspection_logs.email_sent_at`. Secrets: `BREVO_API_KEY`, `SANITARY_ORDER_FROM` ("Name <addr>").

### generate-barangay-summary — LIVE, used by web `BarangaySummaryDialog.tsx`
Body `{from?, to?, barangays?[]}` (default 90-day window, max 366 days). **No role check**; RLS under the caller's JWT limits data.
Pages `inspection_logs` by `inspection_date` (1000/page) + all `establishments`, aggregates in `aggregate.ts` (422 if empty),
one Anthropic call (`claude-opus-5`, JSON-schema output, `max_tokens 16000`, server-side fallback beta) → 
`{narrative, from, to, city, barangays, scope_barangays}`. Writes nothing. Secret: `ANTHROPIC_API_KEY`.
Web turns the result into a jsPDF executive report. Real (non-stubbed) generation untested as of 2026-11-06.

### provision-owner — deployed but **obsolete**, no caller
Replaced by the auto-owner triggers (SQL 10). Admin-only; created an owner auth user with the service role key and
`x-audit-actor` header. Safe to delete once nobody needs the manual path.

## 7. Operational notes

- DDL needs a Supabase personal access token (PAT, `sbp_`) via Management API; the anon/service keys cannot alter tables.
  After DDL run `notify pgrst, 'reload schema'` or REST will not see new columns. The maintainer revokes PATs after use.
- Never run `apply_phase1.py` against the live project: its first step is `00_wipe.sql` (drops tables, deletes auth.users).
  Also `01/02_*.sql` are stale (missing SQL 10–12), so a rebuild from them would lose admin-MFA, auto-owner and `log_event`.
- Firebase (the previous backend, project `inspectra-firebase`) is FROZEN since 2026-10-11 with deny-all rules; delete planned ~2026-11-10.
  Any `firestore.rules`, `firebase_options.dart`, `src/lib/firestore.ts` leftovers are dead.
- Live data 2026-11-05: ~4967 real establishments + 109 OSM_SEED demo rows. Demo rows: `masterlist_sheet='OSM_SEED'`;
  48 real rows also carry coordinates merged from OSM (street/mall level, not exact).
- RLS probe suites (`migration/rls_probes.py` 27 checks anon/officer/admin + storage; `rls_probes_audit.py` 19 checks
  department_head read-only + audit_log) do not cover owners, admin-MFA (SQL 11) or `log_event`.
