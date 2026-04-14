# UI Audit — Clowtec Admin Center
**Stack**: React 18.3.1 · TypeScript · Vite · Tailwind v4 · react-router v7 · Recharts · shadcn/ui (Radix) · Lucide icons

---

## Overall Impression ✅

The UI is well-structured, visually consistent, and correctly scoped for a health inspection management system. The **sage-green (`#87A96B`) design language** is applied uniformly across all pages. Component reuse via shadcn/ui Radix primitives is excellent. All mock data already mirrors realistic backend shapes, which means connecting to a real API will be straightforward.

---

## Page-by-Page Audit

### 1. 🏠 Dashboard (`Dashboard.tsx`)

| Feature | Status | Notes |
|---|---|---|
| KPI stat cards (Establishments, Inspections Today, Critical Failures) | ✅ Good | Straightforward `COUNT()` or aggregate queries from Supabase |
| Violation Hotspot Bar Chart (stacked, weekly) | ✅ Good | Maps well to `GROUP BY week, violation_type` queries |
| Sanitary Grade Donut Chart | ✅ Good | `GROUP BY grade` query + percentage calc |
| Mock GIS mini-map (SVG pins) | ⚠️ Placeholder | Fine for prototype; should be replaced by Leaflet/Mapbox before production |
| Live Inspection Feed table | ✅ Good | Real-time Supabase subscription (`supabase.channel()`) or polling |
| **Missing: Disease Outbreak Risk score** | ❌ Not present | No widget shows the ML risk prediction yet (see Recommendations) |
| **Missing: Risk Offender badge/list** | ❌ Not present | No section highlights repeat-violating establishments |

**Recommendation**: Add a "Disease Outbreak Risk" KPI card (4th stat card) and a "High-Risk Establishments" alert section below the Live Feed, fed by your ML model's API endpoint.

---

### 2. 🗺️ GIS Map (`GISMap.tsx`)

| Feature | Status | Notes |
|---|---|---|
| Custom circular map pins (score-color coded) | ✅ Excellent | Ready to replace coordinates with real lat/lng |
| Selected pin modal (name, score, inspector, barangay) | ✅ Excellent | All fields map to DB columns |
| Autocomplete search by name/barangay | ✅ Good | Needs `useEffect` + Supabase query when real data wired |
| Heatmap toggle (radial red blur on failed establishments) | ✅ Good | Works visually; for accuracy use Leaflet.heat library |
| Quick Stats sidebar (Passed/Warning/Failed counts) | ✅ Good | Derived from inspection score ranges |
| Critical Alerts sidebar card | ✅ Good | Can trigger notifications to inspectors |
| Zoom +/−/Center custom buttons | ✅ Good | Currently cosmetic; tie to real map zoom when using Leaflet |
| **Missing: Risk score overlay on map** | ❌ Not present | Pins should show a ML **Outbreak Risk** ring or badge |
| **Missing: Real map tiles** | ⚠️ SVG only | SVG street grid is presentational — replace with Leaflet + OSM/Mapbox tiles for actual coordinates |

**Recommendation**: Add a `riskScore` field to each pin, render a pulsing red ring around high-risk pins, and add a "Risk Prediction" toggle button beside "Show Heatmap".

---

### 3. 🏢 Establishments (`Establishments.tsx`)

| Feature | Status | Notes |
|---|---|---|
| Card list with name, type, address, barangay, contact, grade, last inspection | ✅ Good | All map directly to a `establishments` table |
| Grade badge (A/B/C/F color-coded) | ✅ Good | Derived field from score |
| "View Details" and "Schedule Inspection" buttons | ✅ Good | Buttons need routing target (e.g., `/establishments/:id`) |
| "Add Establishment" button | ✅ Good | Modal/form not yet built |
| **Missing: Search/filter bar** | ❌ Not present | No way to filter by grade, type, or barangay |
| **Missing: Pagination** | ❌ Not present | Only 5 hard-coded items; needs paginated API calls |
| **Missing: Risk level column** | ❌ Not present | No ML-driven risk tag shown per establishment |

**Recommendation**: Add a filter bar (grade dropdown + barangay select + search input), pagination (shadcn `Pagination` component is already installed), and a "Outbreak Risk" badge per card that comes from your ML model.

---

### 4. 📋 Inspections (`Inspections.tsx`)

| Feature | Status | Notes |
|---|---|---|
| Card list with inspector, establishment, date, time, score, grade, status | ✅ Good | All fields map to an `inspections` table |
| Status badge (Completed / Scheduled / Requires Re-inspection) | ✅ Good | Color-differentiated correctly |
| Contextual action buttons per status | ✅ Excellent | Good UX pattern — backend just needs the right PATCH endpoint |
| "Schedule New Inspection" button | ✅ Good | Modal form not yet built |
| **Missing: Violation breakdown per inspection** | ⚠️ Partial | No checklist of which specific violations were recorded |
| **Missing: Filter by status/date** | ❌ Not present | Large datasets will need filtering |
| **Missing: Evidence attachments** | ❌ Not present | "View Report" button has no target; need photo/document viewer |

**Recommendation**: Build an Inspection Detail page (`/inspections/:id`) with violation checklist, photos, and the computed ML risk score for that inspection round.

---

### 5. 👤 Inspectors (`Inspectors.tsx`)

| Feature | Status | Notes |
|---|---|---|
| Summary stat cards (total, active, inspections today, avg performance) | ✅ Good | Aggregated queries from `inspectors` + `inspections` join |
| Inspector cards (name, ID, email, phone, total inspections, completed today) | ✅ Good | All map to an `inspectors` table |
| Status (Active / On Leave) and Performance (Excellent / Good) badges | ✅ Good | Derived fields; "Performance" should be computed from historical data |
| "View Profile" and "Assign Task" buttons | ✅ Good | Profile page not yet built |
| **Missing: Inspector workload chart** | ⚠️ Nice-to-have | No bar chart showing inspections over time per inspector |
| **Missing: Geographic assignment** | ❌ Not present | No way to see which barangays an inspector is responsible for |

---

### 6. ⚙️ Settings (`Settings.tsx`)

| Feature | Status | Notes |
|---|---|---|
| Profile settings form (first name, last name, email, phone) | ✅ Good | Maps to `users`/`profiles` table in Supabase Auth |
| Notification preference toggles | ✅ Good | Maps to a `notification_settings` table or user metadata |
| Quick Actions (Export, Report, Backup) | ✅ Good | These need real endpoints: CSV export, PDF generation, Supabase Backup API |
| System information panel | ✅ Cosmetic | Version/last updated are hard-coded; fetch from a `system_config` table |
| **Missing: ML Model settings** | ❌ Not present | No control panel for risk threshold sliders (e.g., outbreak alert at score > 0.7) |

---

## Architecture & Tech Stack Assessment

### What's Good
- **shadcn/ui + Radix** — Fully accessible, unstyled primitives. Perfect for a gov-facing admin tool.
- **react-router v7** — Nested layouts with `<Outlet />` is already implemented correctly.
- **Recharts** — Installed and used in Dashboard. Can render all needed charts (bar, pie, line, area).
- **react-hook-form + date-fns** — These are installed and ready for inspection scheduling forms.
- **motion (Framer Motion)** — Available for micro-animations (pin pulse, modal fade-in already uses `animate-in`).
- **Consistent color system** — The `#87A96B` / `#d4183d` / `#FFD700` grade color conventions are applied everywhere.

### What's Missing from the Stack
| Missing Piece | Needed For | Suggested Library |
|---|---|---|
| Supabase JS client | Real data, auth, real-time | `@supabase/supabase-js` |
| Dexie.js | Offline-first PWA / IndexedDB | `dexie` (mentioned in paper spec) |
| Leaflet / React-Leaflet | Real GIS map tiles | `react-leaflet` + OpenStreetMap |
| Background sync / Service Worker | PWA offline-first | `vite-plugin-pwa` |
| Axios or `fetch` wrapper | ML model API calls | Native `fetch` or `axios` |
| Form validation schema | Add/edit forms | `zod` + `@hookform/resolvers` |

---

## Backend Feasibility: Disease Outbreak Risk & Risk Offender Prediction

### ✅ What maps directly to a standard Supabase backend

| UI Feature | Required DB Table / Query |
|---|---|
| Total Establishments count | `SELECT COUNT(*) FROM establishments` |
| Inspections today | `SELECT COUNT(*) FROM inspections WHERE date = today` |
| Critical Failures | `SELECT COUNT(*) FROM inspections WHERE grade IN ('C','F') AND date = today` |
| Grade distribution pie | `SELECT grade, COUNT(*) FROM inspections GROUP BY grade` |
| Violation trend bar chart | `SELECT week, violation_type, COUNT(*) FROM violations GROUP BY week, violation_type` |
| GIS map pins | `SELECT name, latitude, longitude, score, grade FROM establishments JOIN inspections ...` |
| Inspector performance | `SELECT inspector_id, COUNT(*) FROM inspections GROUP BY inspector_id` |

### 🤖 Connecting the ML Predictions

Both prediction features (**Disease Outbreak Risk** and **Risk Offender**) are feasible additions that slot cleanly into this UI. Here is how:

#### Disease Outbreak Risk
- **Input signals already in UI**: Violation types (Water Supply, Food Safety, Vermin Control, Waste Management), scores, barangay, weekly trend data.
- **ML model**: A time-series or logistic regression model that outputs a `risk_score` (0–1) and `risk_level` (Low/Medium/High/Critical) per barangay per week.
- **Backend integration**: Supabase Edge Function or a FastAPI/Flask microservice exposes a `/predict/outbreak-risk` endpoint.
- **UI integration points**:
  - Dashboard → 4th KPI card ("Overall Outbreak Risk: HIGH")
  - GIS Map → Risk score ring on each pin + Risk Layer toggle
  - Dashboard → Violation Hotspot chart gains a "Predicted Risk" trend line overlay

#### Risk Offender (Repeat Violator Detection)
- **Input signals already in UI**: Establishment ID, historical inspection grades, violation types across multiple inspections.
- **ML model**: Classification model that labels an establishment as a "Risk Offender" if it repeatedly fails specific violations. Rule-based threshold works too (e.g., 2+ F grades in 3 months).
- **Backend integration**: A `risk_offender_flag` boolean + `risk_reason` text column on the `establishments` table, computed nightly via a Supabase scheduled function.
- **UI integration points**:
  - Establishments page → "⚠️ Risk Offender" badge on the card
  - Dashboard → "High-Risk Establishments" alert list below Live Feed
  - GIS Map → Dedicated filter: "Show Risk Offenders Only"

---

## Summary of Gaps to Address Before Backend Integration

| Priority | Gap | Effort |
|---|---|---|
| 🔴 High | Add Supabase client config & auth flow | Medium |
| 🔴 High | Replace all hard-coded mock data with real API calls | High |
| 🔴 High | Add Disease Outbreak Risk widget to Dashboard & GIS Map | Medium |
| 🔴 High | Add Risk Offender badge to Establishments page | Low |
| 🟡 Medium | Real GIS map (Leaflet + OSM tiles) with real lat/lng | Medium |
| 🟡 Medium | Add Inspection Detail page with violation checklist | High |
| 🟡 Medium | Build Add/Edit modals for Establishments, Inspections, Inspectors | High |
| 🟡 Medium | Add search/filter to Establishments and Inspections pages | Medium |
| 🟡 Medium | Implement Dexie.js offline-first sync layer | High |
| 🟢 Low | PWA Service Worker (vite-plugin-pwa) | Medium |
| 🟢 Low | ML model threshold controls in Settings page | Low |
