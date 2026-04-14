import { Card } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { ClipboardCheck, User, Building2, Calendar } from "lucide-react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../../lib/db";

function getGradeColor(grade: string | null) {
  if (!grade) return "#999999";
  switch (grade) {
    case "A":
      return "#87A96B";
    case "B":
      return "#FFD700";
    case "C":
    case "F":
      return "#d4183d";
    default:
      return "#999999";
  }
}

function getStatusColor(status: string) {
  switch (status) {
    case "Completed":
      return "#87A96B";
    case "Scheduled":
      return "#3b82f6";
    case "Requires Re-inspection":
      return "#d4183d";
    default:
      return "#999999";
  }
}

export function Inspections() {
  const inspections = useLiveQuery(async () => {
    const insp = await db.inspections.toArray();
    // Resolve relational names
    return Promise.all(insp.map(async (i) => {
      const est = await db.establishments.get(i.establishment_id);
      const inspector = await db.inspectors.get(i.inspector_id);
      return {
        ...i,
        establishmentName: est?.name || "Unknown Establishment",
        inspectorName: inspector?.name || "Unknown Inspector",
        inspectorBadge: inspector?.inspectorId || i.inspector_id,
      };
    }));
  }, []) ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-bold text-[#333333]">Inspections</h2>
          <p className="text-[#999999] mt-1">View and manage inspection records</p>
        </div>
        <Button className="bg-[#87A96B] hover:bg-[#7a9860] text-white">
          Schedule New Inspection
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {inspections.length === 0 ? (
          <Card className="p-12 bg-white rounded-xl border border-gray-200 text-center">
            <p className="text-[#999999]">No inspections found locally.</p>
            <p className="text-sm text-[#999999] mt-1">Wait for sync or schedule a new one.</p>
          </Card>
        ) : (
          inspections.map((inspection) => (
            <Card key={inspection.id} className="p-6 bg-white rounded-xl border border-gray-200">
              <div className="flex items-start justify-between">
                <div className="flex gap-4 flex-1">
                  <div className="w-12 h-12 rounded-full bg-[#f0f4ed] flex items-center justify-center flex-shrink-0">
                    <ClipboardCheck className="w-6 h-6 text-[#87A96B]" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="font-bold text-[#333333]">{inspection.establishmentName}</h3>
                      {inspection.grade && (
                        <span
                          className="inline-flex items-center px-3 py-1 rounded-full text-sm font-bold"
                          style={{
                            backgroundColor: `${getGradeColor(inspection.grade)}20`,
                            color: getGradeColor(inspection.grade),
                          }}
                        >
                          Grade {inspection.grade} ({inspection.score})
                        </span>
                      )}
                      <span
                        className="inline-flex items-center px-3 py-1 rounded-full text-sm font-bold"
                        style={{
                          backgroundColor: `${getStatusColor(inspection.status)}20`,
                          color: getStatusColor(inspection.status),
                        }}
                      >
                        {inspection.status}
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-x-6 gap-y-2 text-sm">
                      <div className="flex items-center gap-2 text-[#999999]">
                        <User className="w-4 h-4" />
                        <span>
                          {inspection.inspectorName} ({inspection.inspectorBadge})
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-[#999999]">
                        <Calendar className="w-4 h-4" />
                        <span>{inspection.date}</span>
                      </div>
                      <div className="flex items-center gap-2 text-[#999999]">
                        <ClipboardCheck className="w-4 h-4" />
                        <span>{inspection.time}</span>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="flex gap-2 flex-shrink-0">
                  {inspection.status === "Completed" && (
                    <Button size="sm" className="bg-[#87A96B] hover:bg-[#7a9860] text-white">
                      View Report
                    </Button>
                  )}
                  {inspection.status === "Scheduled" && (
                    <Button variant="outline" size="sm">
                      Reschedule
                    </Button>
                  )}
                  {inspection.status === "Requires Re-inspection" && (
                    <Button size="sm" className="bg-[#d4183d] hover:bg-[#c01535] text-white">
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
