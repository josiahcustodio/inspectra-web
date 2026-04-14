import { Card } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { TrendingUp, TrendingDown, Building2, ClipboardCheck, AlertTriangle, MapPin, ArrowRight } from "lucide-react";
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

// Mock data for violations trend (last 6 weeks)
const violationData = [
  { week: "Week 1", "Water Supply": 12, "Vermin Control": 8, "Food Safety": 15, "Waste Management": 10 },
  { week: "Week 2", "Water Supply": 15, "Vermin Control": 10, "Food Safety": 12, "Waste Management": 8 },
  { week: "Week 3", "Water Supply": 18, "Vermin Control": 12, "Food Safety": 10, "Waste Management": 14 },
  { week: "Week 4", "Water Supply": 22, "Vermin Control": 9, "Food Safety": 14, "Waste Management": 11 },
  { week: "Week 5", "Water Supply": 25, "Vermin Control": 11, "Food Safety": 16, "Waste Management": 13 },
  { week: "Week 6", "Water Supply": 28, "Vermin Control": 13, "Food Safety": 18, "Waste Management": 15 },
];

function getGradeColor(grade: string) {
  switch (grade) {
    case "A": return "#10B981"; // Emerald CTA from generated design
    case "B": return "#F59E0B"; // Amber
    case "C":
    case "F": return "#EF4444"; // Red
    default: return "#94A3B8"; // Slate 400
  }
}

// Glassmorphism classes for reusability
const glassCard = "backdrop-blur-xl bg-white/5 border border-white/10 rounded-2xl shadow-xl transition-all duration-300 hover:-translate-y-1 hover:shadow-2xl overflow-hidden cursor-pointer";

export function Dashboard() {
  const establishmentsCount = useLiveQuery(() => db.establishments.count()) ?? 0;
  
  const today = new Date().toISOString().split('T')[0];
  const inspectionsToday = useLiveQuery(() => 
    db.inspections.where("date").equals(today).count()
  ) ?? 0;

  const criticalFailures = useLiveQuery(() => 
    db.inspections
      .where("grade")
      .anyOf(["C", "F"])
      .and(insp => insp.date === today)
      .count()
  ) ?? 0;

  const gradeCounts = useLiveQuery(async () => {
    const counts = { A: 0, B: 0, C: 0, F: 0 };
    const all = await db.inspections.toArray();
    all.forEach(i => {
      if (i.grade && counts[i.grade as keyof typeof counts] !== undefined) {
        counts[i.grade as keyof typeof counts]++;
      }
    });
    return counts;
  }, []);

  const totalGrades = gradeCounts ? Object.values(gradeCounts).reduce((a,b)=>a+b,0) : 1;
  const gradeData = [
    { name: "A (Excellent)", value: gradeCounts ? Math.round((gradeCounts.A / totalGrades) * 100) : 0, color: "#10B981" },
    { name: "B (Satisfactory)", value: gradeCounts ? Math.round((gradeCounts.B / totalGrades) * 100) : 0, color: "#F59E0B" },
    { name: "C/F (Failed)", value: gradeCounts ? Math.round(((gradeCounts.C + gradeCounts.F) / totalGrades) * 100) : 0, color: "#EF4444" },
  ];

  const mapPins = useLiveQuery(async () => {
    const ests = await db.establishments.limit(10).toArray();
    return ests.map((e, index) => ({
      id: e.id,
      x: 20 + (index * 15) % 70, 
      y: 30 + (index * 20) % 60, 
      name: e.business_name
    }));
  }, []) ?? [];

  const recentInspections = useLiveQuery(async () => {
    const insp = await db.inspections.reverse().limit(6).toArray();
    const enhanced = await Promise.all(insp.map(async (i) => {
      const est = await db.establishments.get(i.establishment_id);
      return {
        id: i.id,
        establishment: est?.business_name || "Unknown",
        inspector: i.inspector_id,
        score: i.score,
        grade: i.grade || "-",
        date: i.date
      };
    }));
    return enhanced;
  }, []) ?? [];

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* Header section */}
      <div className="mb-8">
        <h1 className="text-3xl font-extrabold tracking-tight text-white mb-2">Platform Overview</h1>
        <p className="text-slate-400 font-medium">Welcome back. Here's what's happening today in Batangas City.</p>
      </div>

      {/* Bento Grid Layer 1 */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        
        {/* KPI 1 */}
        <div className={`col-span-1 p-6 flex flex-col justify-between ${glassCard}`}>
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-medium text-slate-400 mb-2">Total Directory</p>
              <h3 className="text-4xl font-bold text-white">{establishmentsCount}</h3>
            </div>
            <div className="w-10 h-10 rounded-full bg-indigo-500/20 flex items-center justify-center border border-indigo-500/30">
              <Building2 className="w-5 h-5 text-indigo-400" />
            </div>
          </div>
          <div className="mt-4 flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-emerald-400" />
            <span className="text-sm text-emerald-400 font-medium">99% synced</span>
          </div>
        </div>

        {/* KPI 2 */}
        <div className={`col-span-1 p-6 flex flex-col justify-between ${glassCard}`}>
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-medium text-slate-400 mb-2">Today's Audits</p>
              <h3 className="text-4xl font-bold text-white">{inspectionsToday}</h3>
            </div>
            <div className="w-10 h-10 rounded-full bg-emerald-500/20 flex items-center justify-center border border-emerald-500/30">
              <ClipboardCheck className="w-5 h-5 text-emerald-400" />
            </div>
          </div>
          <div className="mt-4 flex items-center gap-2">
            <span className="text-sm text-slate-400 font-medium">Active sessions logged securely.</span>
          </div>
        </div>

        {/* Action Priority / Critical */}
        <div className={`col-span-1 md:col-span-2 p-6 flex flex-col justify-between relative overflow-hidden group border border-red-500/20 bg-red-500/5 backdrop-blur-xl rounded-2xl shadow-xl transition-all hover:border-red-500/40 cursor-pointer`}>
          <div className="absolute top-0 right-0 p-8 opacity-10 group-hover:opacity-20 transition-opacity">
             <AlertTriangle className="w-32 h-32 text-red-500" />
          </div>
          <div className="relative z-10 flex items-start justify-between">
            <div>
              <p className="text-sm font-medium text-red-400 mb-2 uppercase tracking-wider">Requires Immediate Attention</p>
              <h3 className="text-5xl font-bold text-white">{criticalFailures}</h3>
              <p className="text-xl font-medium text-slate-200 mt-2">Critical Failures detected</p>
            </div>
          </div>
          <div className="relative z-10 mt-6 flex items-center gap-2">
            <Button className="bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/30 transition-colors">
              Dispatch Re-inspection <ArrowRight className="ml-2 w-4 h-4"/>
            </Button>
          </div>
        </div>
      </div>

      {/* Bento Grid Layer 2: Analytics */}
      <div className="grid grid-cols-1 lg:grid-cols-6 gap-6">
        
        {/* Main Chart spanning 4 cols */}
        <div className={`col-span-1 lg:col-span-4 p-6 ${glassCard}`}>
          <div className="mb-6 flex items-center justify-between">
            <div>
              <h3 className="text-xl font-extrabold text-white tracking-tight">Violation Hotspots</h3>
              <p className="text-sm text-slate-400 truncate">Machine learning flagged recurring categories across sectors.</p>
            </div>
          </div>
          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={violationData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                <XAxis dataKey="week" stroke="#94A3B8" tick={{ fill: '#94A3B8', fontSize: 12 }} axisLine={false} tickLine={false} />
                <YAxis stroke="#94A3B8" tick={{ fill: '#94A3B8', fontSize: 12 }} axisLine={false} tickLine={false} />
                <Tooltip
                  cursor={{ fill: '#334155', opacity: 0.4 }}
                  contentStyle={{
                    backgroundColor: "rgba(15, 23, 42, 0.9)",
                    border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: "12px",
                    backdropFilter: "blur(12px)",
                    color: "#fff"
                  }}
                  itemStyle={{ color: '#fff' }}
                />
                <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '10px' }} />
                <Bar dataKey="Water Supply" stackId="a" fill="#6366F1" radius={[0, 0, 0, 0]} />
                <Bar dataKey="Vermin Control" stackId="a" fill="#F59E0B" radius={[0, 0, 0, 0]} />
                <Bar dataKey="Food Safety" stackId="a" fill="#10B981" radius={[0, 0, 0, 0]} />
                <Bar dataKey="Waste Management" stackId="a" fill="#EF4444" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Grade Distribution spanning 2 cols */}
        <div className={`col-span-1 lg:col-span-2 p-6 flex flex-col ${glassCard}`}>
          <div className="mb-2">
            <h3 className="text-xl font-extrabold text-white tracking-tight">Grade Distribution</h3>
            <p className="text-sm text-slate-400">Current quarter compliance rate</p>
          </div>
          <div className="flex-1 flex flex-col justify-center">
            <div className="h-[220px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={gradeData}
                    cx="50%"
                    cy="50%"
                    innerRadius={65}
                    outerRadius={85}
                    paddingAngle={4}
                    dataKey="value"
                    stroke="none"
                  >
                    {gradeData.map((entry, index) => (
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
            <div className="mt-4 space-y-3 px-2">
              {gradeData.map((item) => (
                <div key={item.name} className="flex items-center justify-between group">
                  <div className="flex items-center gap-3">
                    <div className="w-3 h-3 rounded-full shadow-sm" style={{ backgroundColor: item.color }} />
                    <span className="text-sm text-slate-300 group-hover:text-white transition-colors">{item.name}</span>
                  </div>
                  <span className="font-bold text-white">{item.value}%</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Bento Grid Layer 3: GIS and Table */}
      <div className="grid grid-cols-1 lg:grid-cols-6 gap-6">
        
        {/* GIS Map spanning 2 cols */}
        <div className={`col-span-1 lg:col-span-2 p-6 flex flex-col ${glassCard}`}>
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-xl font-extrabold text-white tracking-tight">Live Tracker</h3>
            <div className="px-2 py-1 rounded bg-indigo-500/20 text-white text-xs font-bold border border-indigo-500/30">
              Active
            </div>
          </div>
          <div className="relative flex-1 min-h-[250px] bg-slate-900/50 rounded-xl overflow-hidden border border-white/5">
            {/* Dark mode mock map background */}
            <div className="absolute inset-0 bg-gradient-to-br from-[#0F172A] to-[#1E293B]">
              <svg className="w-full h-full opacity-10">
                <defs>
                  <pattern id="grid-dark" width="30" height="30" patternUnits="userSpaceOnUse">
                    <path d="M 30 0 L 0 0 0 30" fill="none" stroke="#6366F1" strokeWidth="0.5" />
                  </pattern>
                </defs>
                <rect width="100%" height="100%" fill="url(#grid-dark)" />
              </svg>
            </div>
            {mapPins.map((pin) => (
              <div key={pin.id} className="absolute group cursor-pointer" style={{ left: `${pin.x}%`, top: `${pin.y}%` }}>
                <span className="absolute w-4 h-4 bg-indigo-500/50 rounded-full animate-ping -left-2 -top-2"></span>
                <span className="absolute w-2 h-2 bg-indigo-400 rounded-full -left-1 -top-1 shadow-[0_0_10px_rgba(99,102,241,0.8)]"></span>
                
                <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 -translate-y-3 bg-slate-800/90 backdrop-blur-md px-3 py-1.5 rounded-lg border border-white/10 shadow-xl opacity-0 group-hover:opacity-100 transition-all duration-200 whitespace-nowrap z-20">
                  <p className="font-medium text-white text-xs">{pin.name}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Live Feed Table spanning 4 cols */}
        <div className={`col-span-1 lg:col-span-4 p-6 ${glassCard}`}>
          <div className="mb-6 flex items-center justify-between">
            <div>
              <h3 className="text-xl font-extrabold text-white tracking-tight">Recent Activity Stream</h3>
              <p className="text-sm text-slate-400">Live feed of completed audits and compliance checks.</p>
            </div>
            <Button variant="outline" className="text-slate-300 border-white/10 hover:bg-white/10 hover:text-white transition-colors">
              View All
            </Button>
          </div>
          
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="py-3 px-4 text-xs font-medium tracking-wider text-slate-400 uppercase">Establishment</th>
                  <th className="py-3 px-4 text-xs font-medium tracking-wider text-slate-400 uppercase">Inspector</th>
                  <th className="py-3 px-4 text-xs font-medium tracking-wider text-slate-400 uppercase">Rating</th>
                  <th className="py-3 px-4 text-xs font-medium tracking-wider text-slate-400 uppercase hidden sm:table-cell">Date</th>
                  <th className="py-3 px-4 text-xs font-medium tracking-wider text-slate-400 uppercase text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {recentInspections.map((inspection) => (
                  <tr key={inspection.id} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors group">
                    <td className="py-4 px-4 text-sm font-medium text-white">
                      {inspection.establishment}
                    </td>
                    <td className="py-4 px-4 text-sm text-slate-400">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full bg-slate-700 flex items-center justify-center text-xs text-white">
                          {inspection.inspector.substring(0, 2).toUpperCase()}
                        </div>
                        {inspection.inspector}
                      </div>
                    </td>
                    <td className="py-4 px-4">
                      <span
                        className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold border"
                        style={{
                          backgroundColor: `${getGradeColor(inspection.grade)}15`,
                          color: getGradeColor(inspection.grade),
                          borderColor: `${getGradeColor(inspection.grade)}30`
                        }}
                      >
                        {inspection.score} - Grade {inspection.grade}
                      </span>
                    </td>
                    <td className="py-4 px-4 text-sm text-slate-400 hidden sm:table-cell">
                      {new Date(inspection.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                    </td>
                    <td className="py-4 px-4 text-right">
                      <Button size="sm" className="bg-white/10 text-white hover:bg-white/20 border-none transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100">
                        Details
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {recentInspections.length === 0 && (
              <div className="text-center py-8 text-slate-500 text-sm">
                No recent activity to show.
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
