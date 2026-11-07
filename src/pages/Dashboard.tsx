import { useMemo } from "react";
import { Building2, ClipboardCheck, AlertTriangle, MapPin } from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { BarangaySummaryDialog } from "@/components/BarangaySummaryDialog";
import { BARANGAY_NAMES, barangayOfEstablishment, canonicalBarangay } from "@/lib/barangayGeo";
import { useCollection } from "@/lib/useCollection";
import { COLLECTIONS, mapEstablishment, mapInspectionLog } from "@/lib/firestore";
import {
  PASSING_SCORE,
  RATING_BANDS,
  emptyBandCounts,
  isHighRisk,
  ratingBand,
  ratingColor,
} from "@/lib/ratingScale";

// [REF: CARD_SURFACE_STYLE]
// The only shared style constant in the web app. Every other screen spells
// its classes out inline, which is why a visual change usually means editing
// several files rather than one.
const glassCard = "bg-white rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] transition-all duration-300 hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] overflow-hidden cursor-pointer dark:backdrop-blur-xl dark:bg-white/5 dark:border-white/10";

export function Dashboard() {
  // Live table subscriptions (Supabase Realtime) — both stay `undefined` until their first
  // snapshot lands, which is what keeps the KPI block showing zeroes instead of
  // a half-computed figure while the data is still in flight.
  const { data: establishments, error: estError } = useCollection(COLLECTIONS.establishments, mapEstablishment);
  const { data: inspectionLogs, error: logError } = useCollection(COLLECTIONS.inspectionLogs, mapInspectionLog);
  const loadError = estError ?? logError;

  // [REF: KPI_STATS]
  const stats = useMemo(() => {
    if (!establishments || !inspectionLogs) {
      return {
        inspectedBarangays: 0,
        totalBarangays: BARANGAY_NAMES.length,
        inspectedEstablishments: 0,
        totalEstablishments: 0,
        scoredInspections: 0,
        complianceRating: "0%",
        highRiskBarangays: 0,
        gradeData: RATING_BANDS.map(b => ({
          name: b.label,
          range: b.range,
          value: 0,
          count: 0,
          color: b.color,
        })),
        barangayData: [] as { name: string; avg: number; count: number; color: string }[],
      };
    }

    let totalScore = 0;
    let countScore = 0;
    // [REF: RATING_SCALE] one tally per band, keyed by the shared band ids
    const bandCounts = emptyBandCounts();

    const barangayScores: Record<string, { total: number, count: number }> = {};
    const inspectedEstablishments = new Set<string>();

    // Official spelling only, so a barangay counts once however the record
    // spells it, and an unresolvable address is left out of the fraction.
    const estToBrgy = new Map<string, string>();
    for (const est of establishments) {
      const brgy = canonicalBarangay(barangayOfEstablishment(est));
      if (brgy) estToBrgy.set(est.id, brgy);
    }

    for (const log of inspectionLogs) {
      const score = log.percentage_rating;
      if (score === null || score === undefined) continue;

      totalScore += score;
      countScore++;

      bandCounts[ratingBand(score)]++;

      if (log.establishment_id) inspectedEstablishments.add(log.establishment_id);
      const brgy = log.establishment_id ? estToBrgy.get(log.establishment_id) : null;
      if (!brgy) continue;

      if (!barangayScores[brgy]) barangayScores[brgy] = { total: 0, count: 0 };
      barangayScores[brgy].total += score;
      barangayScores[brgy].count += 1;
    }

    const avgCompliance = countScore > 0 ? Math.round(totalScore / countScore) : 0;

    let highRiskCount = 0;
    for (const [brgy, s] of Object.entries(barangayScores)) {
      if (s.count > 0 && isHighRisk(s.total / s.count)) {
        highRiskCount++;
      }
    }

    // Lowest average first; the bar takes the colour of the band the average
    // falls in, so a red bar is a barangay averaging below passing.
    const lowestAverage = Object.entries(barangayScores)
      .map(([name, s]) => ({
        name,
        avg: Math.round(s.total / s.count),
        count: s.count,
        color: ratingColor(s.total / s.count),
      }))
      .sort((a, b) => a.avg - b.avg || b.count - a.count)
      .slice(0, 6);

    return {
      inspectedBarangays: Object.keys(barangayScores).length,
      totalBarangays: BARANGAY_NAMES.length,
      inspectedEstablishments: inspectedEstablishments.size,
      totalEstablishments: establishments.length,
      scoredInspections: countScore,
      complianceRating: `${avgCompliance}%`,
      highRiskBarangays: highRiskCount,
      gradeData: RATING_BANDS.map(b => ({
        name: b.label,
        range: b.range,
        value: countScore > 0 ? Math.round((bandCounts[b.band] / countScore) * 100) : 0,
        count: bandCounts[b.band],
        color: b.color,
      })),
      barangayData: lowestAverage,
    };
  }, [establishments, inspectionLogs]);

  const {
    inspectedBarangays, totalBarangays, inspectedEstablishments, totalEstablishments,
    scoredInspections, complianceRating, highRiskBarangays, gradeData, barangayData,
  } = stats;
  const pct = (n: number, d: number) => (d > 0 ? Math.min(100, (n / d) * 100) : 0);

  const chartData = gradeData.filter(d => d.value > 0);
  const chartPadding = chartData.length > 1 ? 4 : 0;

  // Zeroes while the tables download read as "no data", so hold a spinner
  // until both snapshots exist, and say so when a read failed.
  if (!establishments || !inspectionLogs) {
    return (
      <div className="h-full w-full flex flex-col items-center justify-center gap-3 text-center">
        {loadError ? (
          <p className="text-sm text-red-700">Could not load the dashboard: {loadError.message}</p>
        ) : (
          <>
            <div className="w-8 h-8 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
            <p className="text-sm text-muted-foreground font-medium">Loading inspections and establishments…</p>
          </>
        )}
      </div>
    );
  }



  return (
    <div className="h-full w-full flex flex-col gap-4 max-w-7xl mx-auto">
      {/* Header section */}
      <div className="flex-shrink-0 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-slate-900 mb-1">Establishments Overview</h1>
          <p className="text-muted-foreground font-medium text-sm">Welcome back. Here's what's happening today in Batangas City.</p>
        </div>
        {/* [REF: AI_BARANGAY_SUMMARY] */}
        <BarangaySummaryDialog establishments={establishments} logs={inspectionLogs} />
      </div>

      {loadError && (
        <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 flex-shrink-0">
          Showing the last loaded figures. Refresh failed: {loadError.message}
        </p>
      )}

      {/* Bento Grid Layer 1 */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4 flex-shrink-0">

        {/* KPI 1 */}
        <div className={`col-span-1 p-4 flex flex-col justify-between ${glassCard}`}>
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-bold text-slate-600 mb-1 uppercase tracking-wider">Inspected Barangays</p>
              <h3 className="text-5xl font-black text-slate-900 tabular-nums">
                {inspectedBarangays}
                <span className="text-xl font-bold text-slate-400"> / {totalBarangays}</span>
              </h3>
            </div>
            <div className="w-8 h-8 rounded-full bg-indigo-50 flex items-center justify-center border border-indigo-100">
              <MapPin className="w-4 h-4 text-indigo-600" />
            </div>
          </div>
          <div className="mt-2">
            <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden" role="progressbar" aria-valuenow={inspectedBarangays} aria-valuemax={totalBarangays}>
              <div className="h-full rounded-full bg-indigo-500 transition-all" style={{ width: `${pct(inspectedBarangays, totalBarangays)}%` }} />
            </div>
            <span className="text-xs text-muted-foreground font-bold">{Math.round(pct(inspectedBarangays, totalBarangays))}% of Batangas City</span>
          </div>
        </div>

        {/* KPI 1b: establishments reached */}
        <div className={`col-span-1 p-4 flex flex-col justify-between ${glassCard}`}>
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-bold text-slate-600 mb-1 uppercase tracking-wider">Inspected Establishments</p>
              <h3 className="text-5xl font-black text-slate-900 tabular-nums">
                {inspectedEstablishments}
                <span className="text-xl font-bold text-slate-400"> / {totalEstablishments.toLocaleString()}</span>
              </h3>
            </div>
            <div className="w-8 h-8 rounded-full bg-sky-50 flex items-center justify-center border border-sky-100">
              <Building2 className="w-4 h-4 text-sky-600" />
            </div>
          </div>
          <div className="mt-2">
            <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden" role="progressbar" aria-valuenow={inspectedEstablishments} aria-valuemax={totalEstablishments}>
              <div className="h-full rounded-full bg-sky-500 transition-all" style={{ width: `${pct(inspectedEstablishments, totalEstablishments)}%` }} />
            </div>
            <span className="text-xs text-muted-foreground font-bold">{pct(inspectedEstablishments, totalEstablishments).toFixed(1)}% of the masterlist</span>
          </div>
        </div>

        {/* KPI 2 */}
        <div className={`col-span-1 p-4 flex flex-col justify-between ${glassCard}`}>
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-bold text-slate-600 mb-1 uppercase tracking-wider">Active Compliance Rating</p>
              <h3 className="text-5xl font-black text-slate-900">{complianceRating}</h3>
            </div>
            <div className="w-8 h-8 rounded-full bg-emerald-50 flex items-center justify-center border border-emerald-100">
              <ClipboardCheck className="w-4 h-4 text-emerald-600" />
            </div>
          </div>
          <div className="mt-2 flex items-center gap-1">
            <span className="text-xs text-muted-foreground font-bold">Baseline status logged securely.</span>
          </div>
        </div>

        {/* Action Priority / Critical */}
        <div className={`col-span-1 md:col-span-2 p-4 flex flex-col justify-between relative overflow-hidden group border-2 border-destructive bg-destructive/5 rounded-2xl shadow-sm transition-all hover:border-destructive/40 cursor-pointer`}>
          <div className="absolute top-0 right-0 p-8 opacity-10 group-hover:opacity-20 transition-opacity">
             <AlertTriangle className="w-32 h-32 text-destructive" />
          </div>
          <div className="relative z-10 flex items-start justify-between">
            <div>
              <p className="text-xs font-black text-destructive mb-1 uppercase tracking-wider">High-Risk Barangays Detected</p>
              <h3 className="text-5xl font-black text-destructive">{highRiskBarangays}</h3>
              <p className="text-sm font-bold text-destructive/80 mt-1">Requires Immediate Attention</p>
            </div>
          </div>
          <div className="relative z-10 mt-2 flex items-center gap-2">
            <span className="text-xs font-bold text-destructive/70">Barangays averaging below {PASSING_SCORE}% &mdash; the lowest rating band</span>
          </div>
        </div>
      </div>

      {/* Lower Section */}
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 gap-4">

        {/* Main Chart spanning 7 cols */}
        <div className={`col-span-1 lg:col-span-7 flex flex-col ${glassCard} p-4 min-h-0`}>
          <div className="mb-2 flex-shrink-0 flex items-center justify-between">
            <div>
              <h3 className="text-xl font-extrabold text-slate-900 tracking-tight">Barangays with Lowest Average Compliance</h3>
              <p className="text-sm text-muted-foreground truncate font-medium">Average sanitary rating per barangay across all inspections, lowest first.</p>
            </div>
          </div>
          <div className="flex-1 min-h-0 w-full">
            <ResponsiveContainer width="100%" height="100%">
              {/* [REF: BAR_GRAPH] */}
              <BarChart data={barangayData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="name" stroke="#64748b" tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} interval={0} angle={-25} textAnchor="end" height={60} />
                <YAxis domain={[0, 100]} unit="%" stroke="#64748b" tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip
                  cursor={{ fill: '#f1f5f9', opacity: 0.4 }}
                  contentStyle={{
                    backgroundColor: "rgba(255, 255, 255, 0.95)",
                    border: "1px solid rgba(0,0,0,0.1)",
                    borderRadius: "12px",
                    boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)",
                    color: "#0f172a"
                  }}
                  itemStyle={{ color: '#0f172a', fontWeight: 'bold' }}
                  formatter={(value, _name, item) => [
                    `${value}% average over ${item.payload.count} inspection${item.payload.count === 1 ? "" : "s"}`,
                    "Compliance",
                  ]}
                />
                <Bar dataKey="avg" radius={[4, 4, 0, 0]}>
                  {barangayData.map((entry) => (
                    <Cell key={entry.name} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Right Side spanning 5 cols */}
        <div className="col-span-1 lg:col-span-5 flex flex-col gap-4 min-h-0">

          {/* Grade Distribution */}
          <div className={`flex-1 flex flex-col ${glassCard} p-6 min-h-0`}>
            <div className="mb-6 flex-shrink-0">
              <h3 className="text-xl font-extrabold text-slate-900 tracking-tight">City-Wide Clearance Level</h3>
              <p className="text-sm text-muted-foreground truncate font-medium mt-1">Inspections in each sanitary rating band, count and share.</p>
            </div>

            {/* Horizontal Split Layout */}
            <div className="flex-1 flex flex-row items-center justify-between min-h-0 gap-8 px-2">

              {/* Left: Donut Chart with fixed aspect ratio */}
              <div className="relative w-[120px] h-[120px] aspect-square flex-shrink-0">
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <span className="text-2xl font-black text-slate-900 tabular-nums leading-none">{scoredInspections}</span>
                  <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">rated</span>
                </div>
                <ResponsiveContainer width="100%" height="100%">
                  {/* [REF: PIE_GRAPH] */}
                  <PieChart>
                    <Pie
                      data={chartData}
                      cx="50%"
                      cy="50%"
                      innerRadius={45}
                      outerRadius={60}
                      paddingAngle={chartPadding}
                      dataKey="value"
                      stroke="none"
                    >
                      {chartData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip 
                      contentStyle={{
                        backgroundColor: "rgba(15, 23, 42, 0.9)",
                        border: "1px solid rgba(255,255,255,0.1)",
                        borderRadius: "12px",
                      }}
                      itemStyle={{ color: '#fff' }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>

              {/* Right: Legend */}
              <div className="flex-1 flex flex-col justify-center space-y-4">
                {gradeData.map((item) => (
                  <div key={item.name} className="flex items-center justify-between group">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-3 h-3 rounded-full shadow-sm flex-shrink-0" style={{ backgroundColor: item.color }} />
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-slate-600 truncate">{item.name}</p>
                        <p className="text-xs font-bold text-muted-foreground">{item.range}</p>
                      </div>
                    </div>
                    <span className="text-base font-black text-slate-900 tabular-nums whitespace-nowrap">
                      {item.count}
                      <span className="text-sm font-bold text-slate-400"> &middot; {item.value}%</span>
                    </span>
                  </div>
                ))}
              </div>

            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
