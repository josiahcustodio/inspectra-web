import { Card } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { ClipboardCheck, User, Building2, Calendar } from "lucide-react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../../lib/db";

function getGradeColor(grade: string | null) {
  if (!grade) return "var(--muted-foreground)";
  switch (grade) {
    case "A":
      return "#10b981";
    case "B":
      return "#F59E0B";
    case "C":
    case "F":
      return "var(--destructive)";
    default:
      return "var(--muted-foreground)";
  }
}

function getStatusColor(status: string) {
  switch (status) {
    case "Completed":
      return "#10b981";
    case "Scheduled":
      return "#3b82f6";
    case "Requires Re-inspection":
      return "var(--destructive)";
    default:
      return "var(--muted-foreground)";
  }
}

function computeGrade(rating: number | null): string | null {
  if (rating === null) return null;
  if (rating >= 90) return "A";
  if (rating >= 80) return "B";
  if (rating >= 70) return "C";
  return "F";
}

function getStatus(rating: number | null): string {
  if (rating !== null) return "Completed";
  return "Scheduled";
}

export function Inspections() {
  const inspections = useLiveQuery(async () => {
    const insp = await db.inspection_logs.toArray();
    // Resolve relational names
    return Promise.all(insp.map(async (i) => {
      let estName = "Unknown Establishment";
      if (i.establishment_id) {
        const est = await db.establishments.get(i.establishment_id);
        if (est) estName = est.business_name;
      }
      return {
        ...i,
        establishmentName: estName,
        inspectorName: i.inspector_name || "Unknown Inspector",
        inspectorBadge: "N/A",
        grade: computeGrade(i.percentage_rating),
        score: i.percentage_rating,
        status: getStatus(i.percentage_rating),
        date: i.inspection_date ? i.inspection_date.split('T')[0] : "No Date",
        time: i.inspection_date && i.inspection_date.includes('T') ? i.inspection_date.split('T')[1].substring(0, 5) : "--:--"
      };
    }));
  }, []) ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-bold text-slate-900 text-2xl tracking-tight">Inspections</h2>
          <p className="text-muted-foreground mt-1">View and manage inspection records</p>
        </div>
        <Button className="bg-primary hover:bg-primary/90 text-primary-foreground font-bold shadow-sm">
          Schedule New Inspection
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {inspections.length === 0 ? (
          <Card className="p-12 bg-white rounded-xl  text-center">
            <p className="text-muted-foreground font-bold">No inspections found locally.</p>
            <p className="text-sm text-muted-foreground font-medium mt-1">Wait for sync or schedule a new one.</p>
          </Card>
        ) : (
          inspections.map((inspection) => (
            <Card key={inspection.id} className="p-6 bg-white rounded-xl  hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between">
                <div className="flex gap-4 flex-1">
                  <div className="w-12 h-12 rounded-full bg-slate-100  flex items-center justify-center flex-shrink-0">
                    <ClipboardCheck className="w-6 h-6 text-primary" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="font-bold text-slate-900 text-lg">{inspection.establishmentName}</h3>
                      {inspection.grade && (
                        <span
                          className="inline-flex items-center px-3 py-1 rounded-full text-xs font-bold border"
                          style={{
                            backgroundColor: `color-mix(in srgb, ${getGradeColor(inspection.grade)} 15%, transparent)`,
                            color: getGradeColor(inspection.grade),
                            borderColor: `color-mix(in srgb, ${getGradeColor(inspection.grade)} 30%, transparent)`
                          }}
                        >
                          Grade {inspection.grade} ({inspection.score})
                        </span>
                      )}
                      <span
                        className="inline-flex items-center px-3 py-1 rounded-full text-xs font-bold border"
                        style={{
                          backgroundColor: `color-mix(in srgb, ${getStatusColor(inspection.status)} 15%, transparent)`,
                          color: getStatusColor(inspection.status),
                          borderColor: `color-mix(in srgb, ${getStatusColor(inspection.status)} 30%, transparent)`
                        }}
                      >
                        {inspection.status}
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-x-6 gap-y-2 text-sm">
                      <div className="flex items-center gap-2 text-muted-foreground font-medium">
                        <User className="w-4 h-4" />
                        <span>
                          {inspection.inspectorName} ({inspection.inspectorBadge})
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-muted-foreground font-medium">
                        <Calendar className="w-4 h-4" />
                        <span>{inspection.date}</span>
                      </div>
                      <div className="flex items-center gap-2 text-muted-foreground font-medium">
                        <ClipboardCheck className="w-4 h-4" />
                        <span>{inspection.time}</span>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="flex gap-2 flex-shrink-0">
                  {inspection.status === "Completed" && (
                    <Button size="sm" className="bg-primary hover:bg-primary/90 text-primary-foreground font-bold shadow-sm">
                      View Report
                    </Button>
                  )}
                  {inspection.status === "Scheduled" && (
                    <Button variant="outline" size="sm" className="border-border hover:bg-slate-50 font-bold">
                      Reschedule
                    </Button>
                  )}
                  {inspection.status === "Requires Re-inspection" && (
                    <Button size="sm" className="bg-destructive hover:bg-destructive/90 text-destructive-foreground font-bold shadow-sm">
                      Schedule Re-inspection
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
