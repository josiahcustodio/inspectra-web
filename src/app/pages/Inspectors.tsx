import { Card } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { User, Mail, Phone, ClipboardCheck, Award } from "lucide-react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../../lib/db";

function getStatusColor(status: string) {
  return status === "Active" ? "#87A96B" : "#999999";
}

function getPerformanceColor(performance: string) {
  switch (performance) {
    case "Excellent":
      return "#87A96B";
    case "Good":
      return "#FFD700";
    default:
      return "#999999";
  }
}

export function Inspectors() {
  const inspectors = useLiveQuery(() => db.inspectors.toArray()) ?? [];
  const activeCount = inspectors.filter(i => i.status === "Active").length;
  const todayInspections = inspectors.reduce((acc, curr) => acc + (curr.completedToday || 0), 0);
  
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-bold text-[#333333]">Inspectors</h2>
          <p className="text-[#999999] mt-1">Manage inspection team members</p>
        </div>
        <Button className="bg-[#87A96B] hover:bg-[#7a9860] text-white">
          Add Inspector
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="p-4 bg-white rounded-xl border border-gray-200">
          <p className="text-[#999999] text-sm mb-1">Total Inspectors</p>
          <h3 className="font-bold text-[#333333]">{inspectors.length}</h3>
        </Card>
        <Card className="p-4 bg-white rounded-xl border border-gray-200">
          <p className="text-[#999999] text-sm mb-1">Active Today</p>
          <h3 className="font-bold text-[#87A96B]">{activeCount}</h3>
        </Card>
        <Card className="p-4 bg-white rounded-xl border border-gray-200">
          <p className="text-[#999999] text-sm mb-1">Inspections Today</p>
          <h3 className="font-bold text-[#333333]">{todayInspections}</h3>
        </Card>
        <Card className="p-4 bg-white rounded-xl border border-gray-200">
          <p className="text-[#999999] text-sm mb-1">Avg. Performance</p>
          <h3 className="font-bold text-[#87A96B]">
            {inspectors.length > 0 ? "Excellent" : "N/A"}
          </h3>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {inspectors.length === 0 ? (
          <Card className="p-12 bg-white rounded-xl border border-gray-200 text-center">
            <p className="text-[#999999]">No inspectors found locally.</p>
            <p className="text-sm text-[#999999] mt-1">Wait for sync or add a new one.</p>
          </Card>
        ) : (
          inspectors.map((inspector) => (
          <Card key={inspector.id} className="p-6 bg-white rounded-xl border border-gray-200">
            <div className="flex items-start justify-between">
              <div className="flex gap-4 flex-1">
                <div className="w-16 h-16 rounded-full bg-[#f0f4ed] flex items-center justify-center flex-shrink-0">
                  <User className="w-8 h-8 text-[#87A96B]" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <h3 className="font-bold text-[#333333]">{inspector.name}</h3>
                    <span className="text-[#999999] text-sm">({inspector.inspectorId})</span>
                    <span
                      className="inline-flex items-center px-3 py-1 rounded-full text-sm font-bold"
                      style={{
                        backgroundColor: `${getStatusColor(inspector.status)}20`,
                        color: getStatusColor(inspector.status),
                      }}
                    >
                      {inspector.status}
                    </span>
                    <span
                      className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-sm font-bold"
                      style={{
                        backgroundColor: `${getPerformanceColor(inspector.performance)}20`,
                        color: getPerformanceColor(inspector.performance),
                      }}
                    >
                      <Award className="w-3 h-3" />
                      {inspector.performance}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm mb-3">
                    <div className="flex items-center gap-2 text-[#999999]">
                      <Mail className="w-4 h-4" />
                      <span>{inspector.email}</span>
                    </div>
                    <div className="flex items-center gap-2 text-[#999999]">
                      <Phone className="w-4 h-4" />
                      <span>{inspector.phone}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-6 text-sm">
                    <div className="flex items-center gap-2">
                      <ClipboardCheck className="w-4 h-4 text-[#87A96B]" />
                      <span className="text-[#333333]">
                        <span className="font-bold">{inspector.totalInspections}</span> total
                        inspections
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[#333333]">
                        <span className="font-bold text-[#87A96B]">
                          {inspector.completedToday}
                        </span>{" "}
                        completed today
                      </span>
                    </div>
                  </div>
                </div>
              </div>
              <div className="flex gap-2 flex-shrink-0">
                <Button variant="outline" size="sm">
                  View Profile
                </Button>
                <Button size="sm" className="bg-[#87A96B] hover:bg-[#7a9860] text-white">
                  Assign Task
                </Button>
              </div>
            </div>
          </Card>
          ))
        )}
      </div>
    </div>
  );
}
