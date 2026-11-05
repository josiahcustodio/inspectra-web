# Security Headers & ZAP Scan Mitigation

**Date:** 2026-10-10 · **Source:** ZAP 2.17 active scan of https://inspectra-web.onrender.com
(`inspectra-active-Report-.html`, generated Sat 10 Oct 2026 — kept outside the
repo, in the maintainer's local archive, because it embeds full request/response
captures. Not to be confused with `2026-10-10-ZAP-Report-.pdf` in the parent
folder: that is an earlier, differently-scoped baseline scan from the same day
with different counts — 2 Medium / 7 Low.)

Scan result: **0 High · 3 Medium · 5 Low · 6 Informational.**
This document records how each finding was handled and exactly where the
fixes live.

---

## 1. How to apply the fix (Render dashboard — the authoritative place)

The live service was created **manually** in the Render dashboard, so
`render.yaml` is documentation only — Render does not read it for this
service. The headers must be entered by hand:

**Render dashboard → `inspectra-web` → Redirects/Headers → Headers**, one
row per header, path `/*` for all four:

| Header | Value |
|---|---|
| `Content-Security-Policy` | `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https://tile.openstreetmap.org https://fwtgdgeiffnvqyrobixc.supabase.co; connect-src 'self' https://fwtgdgeiffnvqyrobixc.supabase.co wss://fwtgdgeiffnvqyrobixc.supabase.co; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'` |
| `X-Frame-Options` | `DENY` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` |

Headers take effect immediately on save (no redeploy needed for static
sites, but a hard refresh / cache bypass may be needed to see them).

The same values are mirrored in `render.yaml` (with per-directive comments)
so the repo stays the source of truth for *intent*.

### Why each CSP directive is shaped this way

Every source in the policy maps to something the app verifiably loads
(checked against `src/` on 2026-10-10):

| Directive | Source | Used by |
|---|---|---|
| `script-src 'self'` | our Vite bundle only | `index.html` has **no** inline scripts, so no `'unsafe-inline'` — this is the directive that actually blunts XSS |
| `style-src 'unsafe-inline'` | inline styles | Radix UI, Leaflet, Recharts inject style attributes at runtime |
| `style-src fonts.googleapis.com` | Inter stylesheet | `src/styles/fonts.css` `@import` |
| `font-src 'self' fonts.gstatic.com` | Inter `.woff2` | loaded by the Google Fonts stylesheet; `'self'` is headroom so self-hosting Inter later doesn't silently break |
| `img-src tile.openstreetmap.org` | map tiles | `src/pages/GISMap.tsx` Leaflet tile layer |
| `img-src …supabase.co` | photo evidence | `InspectionChecklistView.tsx` renders `photo_evidence_url` from Supabase Storage |
| `img-src data:` | generated images | TOTP QR code in `Settings.tsx` (`QRCode.toDataURL`). Note: `blob:` is deliberately NOT allowed — nothing renders blob: images; the xlsx export's blob URL is a download `href`, which `img-src` does not govern |
| `connect-src …supabase.co` + `wss:` | API traffic | supabase-js REST/auth/realtime |
| `frame-ancestors 'none'` | — | nothing may iframe the app (fixes the clickjacking finding) |

**If the app later loads from a new origin** (a CDN, a different storage
bucket, Google avatar images, …), add that origin to the matching directive
in **both** the dashboard and `render.yaml`, and note it in the table above.

Two known couplings to keep in mind:

- **The Supabase origin appears twice**: baked into the bundle from the
  dashboard env var `VITE_SUPABASE_URL`, and hardcoded in this CSP. There is
  no automatic consistency check. If the Supabase project URL ever changes,
  update `img-src`/`connect-src` in the dashboard header AND `render.yaml`,
  or every API call and photo load will be CSP-blocked.
- **No `worker-src` is declared**, so it falls back to `default-src 'self'`,
  which blocks `blob:` workers. supabase-js works fine today, but if realtime
  is ever switched to worker mode (`realtime: {worker: true}` in
  `src/lib/supabase.ts`), add `worker-src 'self' blob:` in both places first.

---

## 2. Finding-by-finding disposition

### Fixed (our origin, inspectra-web.onrender.com)

| Finding | Risk | Fix |
|---|---|---|
| Content Security Policy (CSP) Header Not Set | Medium | `Content-Security-Policy` header above |
| Missing Anti-clickjacking Header | Medium | `frame-ancestors 'none'` + `X-Frame-Options: DENY` |

### Already in place (no action — verify in rescan)

Captured responses from our origin already carried
`Strict-Transport-Security: max-age=315360000; includeSubdomains; preload`
and `X-Content-Type-Options: nosniff` (served by Render/Cloudflare). The
HSTS / X-Content-Type-Options findings in the report apply only to
third-party hosts.

### False positives (our origin)

**Timestamp Disclosure – Unix (Low, 2 instances on `/assets/index-*.js`).**
The "timestamps" are numeric constants inside the minified bundle; one
(`1919054434`) decodes to October **2030**. Library constants, not leaked
times. No action.

### Accepted risks (Supabase, fwtgdgeiffnvqyrobixc.supabase.co)

We cannot set headers on `*.supabase.co`. All findings there are inherent
to a managed public API gateway:

- **Cross-Domain Misconfiguration (Medium):** `Access-Control-Allow-Origin: *`
  is by design — Supabase's REST API is meant to be called cross-origin with
  the publishable key; authorization is enforced by Row Level Security, not
  CORS. Verified in this report: every flagged Supabase instance was a CORS
  **preflight (`OPTIONS`) with a 0-byte body** — no data was returned. The
  migration's RLS probe suite passed 27/27 (`rls_probes.py`, kept in the
  untracked `migration/` folder next to this repo); note most of those probes
  exercise officer/admin role boundaries — only one directly tests anon
  access, so the preflight evidence above is the primary basis for accepting
  this finding.
- **Cookie with SameSite=None / Loosely Scoped Cookie (Low/Info):** this is
  Cloudflare's `__cf_bm` bot-management cookie on Supabase's edge, not an
  application session cookie. Inspectra sessions are JWTs in localStorage,
  not cookies.
- **Timestamp Disclosure (Low):** JWT `iat`/`exp` values — public by design.
- **Authentication Request / Session Management Identified (Info):** purely
  informational scanner observations.

### Out of scope (not our hosts)

Findings on `fonts.googleapis.com`, `fonts.gstatic.com`,
`*.basemaps.cartocdn.com`, `clientservices.googleapis.com`, and
`content-autofill.googleapis.com` are third-party services — the last two
are **Chrome's own background telemetry**, captured because ZAP proxied the
whole browser. Not actionable by us.

---

## 3. Rescanning correctly

1. In ZAP, define a **Context** limited to `https://inspectra-web.onrender.com.*`
   (optionally also `https://fwtgdgeiffnvqyrobixc.supabase.co.*`) and scan
   "in context only" — this removes the Chrome-telemetry and font-CDN noise.
2. Expected result after the dashboard headers are saved: both Medium
   findings on our origin clear; remaining items are the accepted risks
   documented above.
3. Quick manual check without ZAP:
   `curl -sI https://inspectra-web.onrender.com | grep -i -E "content-security|frame|referrer|permissions"`
