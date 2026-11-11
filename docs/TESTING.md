# Inspectra — tests: what exists, how to run it, what each one proves

Developer-facing companion to the thesis manuscript (3.2.4 Functional Requirements FR-01..18, 3.2.5 Non-Functional
Requirements NFR-01..10, 3.7 Testing and Evaluation, 4.2 Results). The paper-facing write-up, manual test forms and
paste-ready text live in `../../docs/Inspectra_Testing_Guide_2026-11-09.pdf` (parent folder of the repos).

## The four automated suites

| Suite | Where | Command | Last run (2026-11-09) |
|---|---|---|---|
| Web unit tests (vitest) | this repo, `src/**/*.test.ts` | `npm test` | 7 files, 52 tests, all pass, 1.1 s |
| Edge Function tests (Deno) | this repo, `supabase/functions/*/…test.ts` | `npm run test:functions` (needs Deno ≥ 2) | 2 files, 18 tests, all pass |
| Mobile unit + widget tests (flutter_test) | `inspectra-mobile/test/*.dart` | `flutter test` | 11 files, 109 tests, all pass, ~2 min |
| Security: RLS probes (Python, live project) | maintainer's untracked `migration/rls_probes.py`, `rls_probes_audit.py` | `python migration/rls_probes.py` then `python migration/rls_probes_audit.py` (needs `migration/.env`) | 27/27 and 19/19 pass |

Also on record: OWASP ZAP baseline scan of the web portal, 2026-10-10 (`2026-10-10-ZAP-Report-.pdf`), mitigated by the
headers in `render.yaml` / `docs/SECURITY_HEADERS.md`.

Rules:
- A web test sits next to the module it tests and is named `<module>.test.ts`. Only pure logic under `src/lib` is unit
  tested; pages and components are covered by the manual forms in the PDF.
- The band contract (`ratingScale.ts` ↔ mobile `rating_scale.dart` ↔ edge `aggregate.ts`) has a test on all three
  sides. Change a threshold in one place and two suites go red — that is the point.
- The RLS probes sign the probe admin in at AAL2 (they enrol a TOTP factor and verify one code) because
  `11_admin_mfa_required.sql` refuses an admin at AAL1. They create throwaway users and storage objects and delete them
  at the end. They run against the LIVE project; do not run them while an import is in progress.

## Requirement → test map

FR ids follow Table 1 of the 2026-11-08 manuscript. "Manual" = form in the PDF, section 5.

| Req | Automated evidence (file: tests) | Manual evidence still needed |
|---|---|---|
| FR-01 User Authentication | probes: anon denied on every table, each role reads what its policy allows (27); mobile `owner_signin_dialog_test` (6) | sign-in on web and mobile, wrong password refused |
| FR-02 Establishment Management | web `import/normalize.test` (8), `import/matchRows.test` (11); mobile `establishment_details_card_test` (4); probes: officer creates / admin deletes | add + edit from the web form |
| FR-03 Data Synchronization | mobile `inspection_log_test` (9: offline-queue JSON round-trip) | field sync test (airplane mode → Wi-Fi), time to appear on web |
| FR-04 Monitoring Dashboard | web `ratingScale.test` (11); edge `aggregate.test` (4) | chart values vs a hand count |
| FR-05 Offline Inspection Recording | mobile `inspection_log_test`, `category_availability_test` (16), `checklist_field_test` (2), `sanitary_order_test` (28) | complete an inspection in airplane mode, kill app, reopen |
| FR-06 Audit Trail Logging | probes `rls_probes_audit` (13 audit checks: trigger writes INSERT/UPDATE/DELETE, no-op skipped, actor named, nobody can insert/edit/delete) | — |
| FR-07 High-Risk Barangay | web `ratingScale.test` (isHighRisk, PASSING_SCORE), `barangayGeo.test` (7); edge `aggregate.test` | dashboard count vs a hand computation |
| FR-08 Checklist Listing | mobile `category_availability_test` (16), `category_suggester_test` (28), `checklist_field_test` (2) | 24 categories visible on both platforms |
| FR-09 Inspection Record History | web `inspectionDates.test` (6), `pagination.test` (2); mobile `inspection_history_provider_test` (2) | history modal vs mobile history |
| FR-10 Two-Factor Authentication | probes: admin at AAL1 is refused, passes only after TOTP verify (`sign_in_admin`) | enrol on device, wrong code refused |
| FR-11 Account Approval / Roles | probes: new account is `pending` and reads nothing until promoted; officer and head cannot promote themselves | promote via Access page |
| FR-12 Sanitary Order Issuance | mobile `sanitary_order_test` (28); edge `send-sanitary-order/render.test` (14) | e-mail received once, `email_sent_at` set |
| FR-13 Establishment Owner Access | mobile `owner_signin_dialog_test` (6) | owner sees only own establishment (no RLS probe for `owner` yet — gap) |
| FR-14 AI Barangay Report | web `complianceReportScope.test` (7); edge `aggregate.test` (4) | AI narrative figures vs dashboard (form F-14) |
| FR-15 GIS Map | web `barangayGeo.test` (7: 105 polygons, aliases, Poblacion N, address walk) | shading matches lowest band; pin opens summary |
| FR-16 Masterlist Import / Export | web `import/*.test` (19) | real workbook import; export opens in Excel |
| FR-17 Offline Field Map | mobile `establishment_with_location_test` (1) | tiles render in airplane mode |
| FR-18 In-App Update | mobile `app_updater_test` (3: newer build, same/older, wrong ABI) | tampered APK rejected (checksum is checked by the `ota_update` plugin) |
| NFR-01 Performance | — | timing table (form N-01) |
| NFR-02 Security | 46 RLS probes; ZAP scan + headers | — |
| NFR-03 Reliability (offline, no loss) | mobile `inspection_log_test` | field test (form F-03/05) |
| NFR-04 Usability | — | Likert survey (3.8) |
| NFR-05 Scalability | — | dashboard load at ~5 000 establishments (form N-05) |
| NFR-06 Compatibility | — | Chrome / Edge / phone checklist |
| NFR-07 Availability (offline ready) | — | cold start in airplane mode |
| NFR-08 Backup and Recovery | — | Supabase backup + restore screenshot |
| NFR-09 Data Privacy | probes (role scoping), audit immutability | owner scoping (same gap as FR-13) |
| NFR-10 Maintainability | `npx tsc --noEmit` clean, `flutter analyze` clean, 4 suites, `docs/claude/*`, `ANCHORS.md` | — |

## Known gaps (honest list)

- No automated test signs in as an `owner`; FR-13 / NFR-09 owner scoping rests on the policy text and a manual check.
- Sync (FR-03), offline persistence (FR-05, NFR-03, NFR-07) and the map tiles (FR-17) need a device; nothing runs them in CI.
- There is no CI. Every suite is run by hand; the dates above are the evidence.
- The APK checksum rejection (FR-18) is plugin behaviour, not app code, so it is tested manually.
