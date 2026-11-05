# Inspectra Web (admin SPA)

React 18 + Vite + Tailwind v4 SPA, deployed as a Render **static site**
(`inspectra-web.onrender.com`). Backend is Supabase (REST/auth/realtime/storage)
via `@supabase/supabase-js`; authorization lives in Postgres RLS, not in this
client.

## Security invariants — check these whenever you write or review code

The site serves a strict Content-Security-Policy (details and rationale in
`docs/SECURITY_HEADERS.md`). Code changes must stay inside it:

1. **No inline `<script>` and no external script tags.** `script-src` is
   `'self'` with no `unsafe-inline` — that is the policy's whole XSS value.
   All JS goes through the Vite bundle.
2. **Loading from a new origin requires a CSP change first.** Allowed today:
   Supabase (API/storage), `tile.openstreetmap.org` (map tiles), Google Fonts
   (`fonts.googleapis.com` stylesheet, `fonts.gstatic.com` woff2), and `data:`
   images. Anything else (a CDN, an avatar host, a new tile provider) will be
   silently blocked in production — and works fine in local dev, so you won't
   notice. Update the CSP in **both** places (see 4) in the same change.
3. **Known CSP tripwires:** `blob:` images are not allowed (nothing uses them);
   blob workers are not allowed, so enabling supabase-js realtime worker mode
   (`realtime: {worker: true}`) first needs `worker-src 'self' blob:`.
4. **The live headers come from the Render dashboard, not render.yaml.** The
   service was created manually, so render.yaml is documentation. Any header
   change = edit render.yaml (keeps the repo truthful) + re-enter in dashboard
   → inspectra-web → Redirects/Headers. Equally: if `VITE_SUPABASE_URL` ever
   changes, the Supabase origin hardcoded in the CSP must change with it or
   every API call gets blocked.
5. **Secrets never enter this repo or bundle.** Only the publishable Supabase
   key is baked in (that's by design); anything privileged belongs in RLS
   policies or server-side, never in client code.

## Day-to-day

- `npm run dev` to develop, `npm run build` to build (`dist/`).
- Deploys: push to `main` on GitHub auto-deploys on Render.
- Migration scripts and RLS probes live in the untracked `../migration/`
  folder next to this repo (see `migration/README.md` there).
