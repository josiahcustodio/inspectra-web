# Inspectra — system guide for Claude

Inspectra is the sanitary-inspection system of the **Batangas City Health Office (CHO)**: field inspectors score
establishments (restaurants, water refilling stations, schools, …) against weighted checklists on an Android app,
the office manages data on a web dashboard, and establishment owners read their results and Sanitary Orders.
Student capstone project (2026); maintainer Josiah Custodio. "Clowtec" in paths/ids is the old codename, same product.

## Read these before answering anything non-trivial (they are the source of truth, kept current)

| Question is about | Read |
|---|---|
| Database tables, columns, roles, RLS, triggers, storage, auth config, email templates, Edge Functions | `docs/claude/BACKEND.md` |
| This web repo: routes, pages, lib helpers, import algorithm, rating scale, barangay matching, known bugs | `docs/claude/WEB.md` |
| The mobile app (separate repo `inspectra-mobile`): screens, offline/Hive, scoring, sanitary order, map, APK release/self-update | `docs/claude/MOBILE.md` |
| How a feature works end to end (onboarding, inspection → SO → email → owner, auth/MFA, import, AI report, audit), how things deploy, timeline, open issues | `docs/claude/FLOWS.md` |
| Where a behaviour lives in code: every `[REF: …]` anchor (web + mobile) with file, line range, one-line meaning and the UI control it backs | `docs/claude/ANCHORS.md` |

Answer from those docs first; open source files only to confirm a detail or when the docs don't cover it. Prefer `Grep` for an
identifier over reading whole pages (several pages are 400–700 lines). Everything in `docs/ARCH_GUIDE.md`, `docs/code-walkthrough/`
(parent folder) and the Firebase-era parts of `ARCHITECTURE.md`/`README.md` is historical; the code and `docs/claude/` win on conflict.

## The system in one screen

- **Three parts, one backend.** Web admin SPA (this repo, React 18 + Vite + Tailwind v4, Render static site at
  `https://www.inspectra-cho.com`), Flutter inspector app (`inspectra-mobile`, Android APK side-loaded with GitHub-release self-update),
  and Supabase project `fwtgdgeiffnvqyrobixc` (Postgres + Auth + RLS + 3 Deno Edge Functions). No custom API server; both clients use
  supabase-js / supabase_flutter with the publishable key. **Authorization is Postgres RLS**, client role checks are UI only.
- **Roles** (`profiles.role`, enum `app_role`): `admin` (web, full, TOTP mandatory), `department_head` (web, read-only),
  `officer` (mobile inspector, writes inspections), `owner` (mobile, read own establishments; granted automatically from the point-person
  email an inspector records), `pending` (every new account; grants nothing until an admin promotes it in the web Access page).
- **Core tables:** `establishments` (≈5k, from yearly BPLO masterlist import + manual add), `inspection_logs` (one per inspection, `results` jsonb,
  `percentage_rating`, Sanitary Order columns `so_*`, `deadline`, `email_sent_at`, `proposed_point_person_*`), `categories` + `checklist_templates`
  (weights, optional `fields`), `establishment_permits`, `establishment_contacts` (owner grants), `profiles`, `audit_log`, `upload_batches`, `review_queue`, `inspectors`.
- **Scoring (mobile computes, web displays):** `score = clamp(100 − Σ weights of FAIL items, 0, 100)`; N/A costs nothing.
  Bands: 90–100 Excellent (green #10B981), 70–89 Very Satisfactory (amber #F59E0B), 0–69 Satisfactory = failing/high-risk (red #EF4444).
  `PASSING_SCORE = 70`. Unscored log = "Scheduled". Defined in `src/lib/ratingScale.ts` and mobile `lib/core/rating_scale.dart`.
- **Sanitary Order (CHO-ESD-FR-04):** created on mobile when any item fails (`so_issued_at` marks it); viewed/printed on web; emailed to the
  establishment's point person via Edge Function `send-sanitary-order` (Brevo). No signatures (removed 2026-11-06).
- **Barangays:** 105 PSGC polygons in `src/lib/data/`; `canonicalBarangay()` normalises spellings/aliases/"Poblacion N".
- **Email:** Brevo (SMTP for Auth OTP/confirm/reset; HTTP API for Sanitary Orders). Templates in `supabase/templates/` use plain-text links.
- **AI:** Edge Function `generate-barangay-summary` calls Anthropic `claude-opus-5-5` to draft an executive compliance report; web renders a jsPDF.
- **Audit:** `audit_log` via triggers on 9 tables + `log_event()` RPC for sign-ins/exports/reports; admin-only; web `/admin/audit` shows plain sentences.

## Security invariants for this repo — check whenever you write or review code

The site serves a strict Content-Security-Policy (rationale in `docs/SECURITY_HEADERS.md`). Code changes must stay inside it:

1. **No inline `<script>` and no external script tags.** `script-src 'self'` with no `unsafe-inline`. All JS goes through the Vite bundle.
2. **Loading from a new origin requires a CSP change first.** Allowed today: the Supabase origin (API + wss), `tile.openstreetmap.org`,
   Google Fonts (`fonts.googleapis.com`, `fonts.gstatic.com`), `data:` images. Anything else is silently blocked in production and works in dev.
3. **Tripwires:** `blob:` images not allowed; blob workers not allowed (supabase realtime `worker: true` would need `worker-src 'self' blob:`).
4. **Live headers come from the Render dashboard, not `render.yaml`.** The service was created manually; `render.yaml` is documentation.
   Header change = edit render.yaml + re-enter in dashboard → inspectra-web → Redirects/Headers. If `VITE_SUPABASE_URL` changes, the CSP origin must change too.
5. **Secrets never enter this repo or bundle.** Only the publishable Supabase key is baked in. Privileged work belongs in RLS or Edge Functions.
6. **RLS is the gate.** Never add `department_head` to `is_authorized()`; new `security definer` functions need `revoke execute from anon, authenticated` unless meant as an RPC.

## Day-to-day

- `npm run dev` (localhost:5173), `npm run build` (no typecheck → run `npx tsc --noEmit`).
- Tests: `npm test` (vitest, `src/**/*.test.ts` — pure logic only: rating scale, import cascade, barangay matching, report scope, dates),
  `npm run test:functions` (Deno, the two Edge Function suites). Requirement ↔ test map and manual test forms in `docs/TESTING.md`.
- Deploy: push `main` → Render auto-deploys. Env vars `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` (public by design).
- Schema changes, RLS probes and seed scripts live in the maintainer's **untracked** `migration/` folder (needs a Supabase PAT). You will not have it;
  the resulting schema is documented in `docs/claude/BACKEND.md`. Never reconstruct schema from `ARCH_GUIDE.md` (Firebase era).
- Data-access module is `src/lib/dataAccess.ts` (was `firestore.ts` until 2026-11-08). `src/lib/useCollection.ts` = fetch-all + realtime refetch.
- Dates: `inspection_date` strings without a zone are shown as written (`src/lib/inspectionDates.ts`); report scopes use Asia/Manila days.
