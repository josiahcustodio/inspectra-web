import { useMemo } from "react";
import { Card } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { TrendingUp, Building2, ClipboardCheck, AlertTriangle, ArrowRight } from "lucide-react";
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
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../../lib/db";

function computeGrade(rating: number | null): string {
  if (rating === null) return "-";
  if (rating >= 90) return "A";
  if (rating >= 70) return "B";
  return "F";
}

// Glassmorphism classes for reusability
const glassCard = "bg-white rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] transition-all duration-300 hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] overflow-hidden cursor-pointer dark:backdrop-blur-xl dark:bg-white/5 dark:border-white/10";

export function Dashboard() {
  const establishments = useLiveQuery(() => db.establishments.toArray());
  const inspectionLogs = useLiveQuery(() => db.inspection_logs.toArray());

  const stats = useMemo(() => {
    if (!establishments || !inspectionLogs) {
      return {
        inspectedBarangays: 0,
        complianceRating: "0%",
        highRiskBarangays: 0,
        gradeData: [
          { name: "A (Excellent)", value: 0, color: "#10b981" },
          { name: "B (Satisfactory)", value: 0, color: "#f59e0b" },
          { name: "C/F (Failed)", value: 0, color: "#ef4444" },
        ],
        barangayData: []
      };
    }

    let totalScore = 0;
    let countScore = 0;
    let gradeA = 0;
    let gradeB = 0;
    let gradeC = 0;

    const barangayFailures: Record<string, number> = {};
    const barangayScores: Record<string, { total: number, count: number }> = {};
    const inspectedBarangaysSet = new Set<string>();

    const estToBrgy = new Map<string, string>();
    for (const est of establishments) {
      if (est.barangay) {
        estToBrgy.set(est.id, est.barangay);
      } else if (typeof est.address === 'string' && est.address) {
        // Legacy records where address was still a plain string
        estToBrgy.set(est.id, est.address);
      } else if (est.address && typeof est.address === 'object' && est.address.barangay) {
        // AddEstablishmentModal now writes address as a structured object
        estToBrgy.set(est.id, est.address.barangay);
      }
    }

    for (const log of inspectionLogs) {
      const score = log.percentage_rating;
      if (score === null || score === undefined) continue;

      totalScore += score;
      countScore++;

      if (score >= 90) gradeA++;
      else if (score >= 70) gradeB++;
      else gradeC++;

      const brgy = log.establishment_id ? estToBrgy.get(log.establishment_id) : null;
      const validBrgy = brgy || "Unknown";
      
      inspectedBarangaysSet.add(validBrgy);

      if (score < 70) {
        barangayFailures[validBrgy] = (barangayFailures[validBrgy] || 0) + 1;
      }

      if (!barangayScores[validBrgy]) barangayScores[validBrgy] = { total: 0, count: 0 };
      barangayScores[validBrgy].total += score;
      barangayScores[validBrgy].count += 1;
    }

    const avgCompliance = countScore > 0 ? Math.round(totalScore / countScore) : 0;
    
    let highRiskCount = 0;
    for (const [brgy, s] of Object.entries(barangayScores)) {
      if (s.count > 0 && (s.total / s.count) < 70) {
        highRiskCount++;
      }
    }

    const topNonCompliant = Object.entries(barangayFailures)
      .map(([name, violations]) => ({ name, violations }))
      .sort((a, b) => b.violations - a.violations)
      .slice(0, 6);

    const pctA = countScore > 0 ? Math.round((gradeA / countScore) * 100) : 0;
    const pctB = countScore > 0 ? Math.round((gradeB / countScore) * 100) : 0;
    const pctC = countScore > 0 ? Math.round((gradeC / countScore) * 100) : 0;

    return {
      inspectedBarangays: inspectedBarangaysSet.size,
      complianceRating: `${avgCompliance}%`,
      highRiskBarangays: highRiskCount,
      gradeData: [
        { name: "A (Excellent)", value: pctA, color: "#10b981" },
        { name: "B (Satisfactory)", value: pctB, color: "#f59e0b" },
        { name: "C/F (Failed)", value: pctC, color: "#ef4444" },
      ],
      barangayData: topNonCompliant.length > 0 ? topNonCompliant : [{ name: "No data", violations: 0 }]
    };
  }, [establishments, inspectionLogs]);

  const { inspectedBarangays, complianceRating, highRiskBarangays, gradeData, barangayData } = stats;

  const chartData = gradeData.filter(d => d.value > 0);
  const chartPadding = chartData.length > 1 ? 4 : 0;



  return (
    <div className="h-full w-full flex flex-col gap-4 max-w-7xl mx-auto">
      {/* Header section */}
      <div className="flex-shrink-0">
        <h1 className="text-2xl font-extrabold tracking-tight text-slate-900 mb-1">Establishments Overview</h1>
        <p className="text-muted-foreground font-medium text-sm">Welcome back. Here's what's happening today in Batangas City.</p>
      </div>

      {/* Bento Grid Layer 1 */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 flex-shrink-0">
        
        {/* KPI 1 */}
        <div className={`col-span-1 p-4 flex flex-col justify-between ${glassCard}`}>
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-bold text-slate-600 mb-1 uppercase tracking-wider">Total Inspected Barangays</p>
              <h3 className="text-5xl font-black text-slate-900">{inspectedBarangays}</h3>
            </div>
            <div className="w-8 h-8 rounded-full bg-indigo-50 flex items-center justify-center border border-indigo-100">
              <Building2 className="w-4 h-4 text-indigo-600" />
            </div>
          </div>
          <div className="mt-2 flex items-center gap-1">
            <TrendingUp className="w-3 h-3 text-emerald-600" />
            <span className="text-xs text-emerald-600 font-bold">100% of target covered</span>
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
            <Button size="sm" className="bg-destructive text-destructive-foreground hover:bg-destructive/90 shadow-md transition-colors font-bold text-xs h-8">
              Dispatch Re-inspection <ArrowRight className="ml-1 w-3 h-3"/>
            </Button>
          </div>
        </div>
      </div>

      {/* Lower Section */}
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 gap-4">
        
        {/* Main Chart spanning 7 cols */}
        <div className={`col-span-1 lg:col-span-7 flex flex-col ${glassCard} p-4 min-h-0`}>
          <div className="mb-2 flex-shrink-0 flex items-center justify-between">
            <div>
              <h3 className="text-xl font-extrabold text-slate-900 tracking-tight">Top Non-Compliant Barangays</h3>
              <p className="text-sm text-muted-foreground truncate font-medium">Barangays with the highest recurring violations this month.</p>
            </div>
          </div>
          <div className="flex-1 min-h-0 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={barangayData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="name" stroke="#64748b" tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} interval={0} angle={-25} textAnchor="end" height={60} />
                <YAxis stroke="#64748b" tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
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
                />
                <Bar dataKey="violations" fill="#EF4444" radius={[4, 4, 0, 0]} />
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
              <p className="text-sm text-muted-foreground truncate font-medium mt-1">Overall sanitary inspection grades across all monitored establishments.</p>
            </div>
            
            {/* Horizontal Split Layout */}
            <div className="flex-1 flex flex-row items-center justify-between min-h-0 gap-8 px-2">
              
              {/* Left: Donut Chart with fixed aspect ratio */}
              <div className="w-[120px] h-[120px] aspect-square flex-shrink-0">
                <ResponsiveContainer width="100%" height="100%">
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
                    <div className="flex items-center gap-3">
                      <div className="w-3 h-3 rounded-full shadow-sm flex-shrink-0" style={{ backgroundColor: item.color }} />
                      <span className="text-sm font-bold text-slate-600 truncate">{item.name}</span>
                    </div>
                    <span className="text-base font-black text-slate-900">{item.value}%</span>
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
