import { Card } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Building2, MapPin, Phone, Calendar } from "lucide-react";
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

export function Establishments() {
  const establishments = useLiveQuery(() => db.establishments.toArray()) ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-bold text-[#333333]">Establishments</h2>
          <p className="text-[#999999] mt-1">Manage all registered establishments</p>
        </div>
        <Button className="bg-[#87A96B] hover:bg-[#7a9860] text-white">
          Add Establishment
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {establishments.length === 0 ? (
          <Card className="p-12 bg-white rounded-xl border border-gray-200 text-center">
            <p className="text-[#999999]">No establishments found locally.</p>
            <p className="text-sm text-[#999999] mt-1">Wait for sync or add a new one.</p>
          </Card>
        ) : (
          establishments.map((establishment) => (
            <Card key={establishment.id} className="p-6 bg-white rounded-xl border border-gray-200">
              <div className="flex items-start justify-between">
                <div className="flex gap-4 flex-1">
                  <div className="w-12 h-12 rounded-full bg-[#f0f4ed] flex items-center justify-center flex-shrink-0">
                    <Building2 className="w-6 h-6 text-[#87A96B]" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="font-bold text-[#333333]">{establishment.business_name}</h3>
                      {establishment.category_id && (
                        <span className="inline-flex items-center px-3 py-1 rounded-full text-sm bg-gray-100 text-gray-700">
                          Cat: {establishment.category_id}
                        </span>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                      <div className="flex items-center gap-2 text-[#999999]">
                        <Building2 className="w-4 h-4" />
                        <span>Owner: {establishment.owner_name || "N/A"}</span>
                      </div>
                      <div className="flex items-center gap-2 text-[#999999]">
                        <Phone className="w-4 h-4" />
                        <span>Permit No: {establishment.sanitary_permit_no || "N/A"}</span>
                      </div>
                      <div className="flex items-center gap-2 text-[#999999]">
                        <MapPin className="w-4 h-4" />
                        <span>{establishment.address || "N/A"}</span>
                      </div>
                      <div className="flex items-center gap-2 text-[#999999]">
                        <Calendar className="w-4 h-4" />
                        <span>Reg: {establishment.created_at ? new Date(establishment.created_at).toLocaleDateString() : "N/A"}</span>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="flex gap-2 flex-shrink-0">
                  <Button variant="outline" size="sm">
                    View Details
                  </Button>
                  <Button size="sm" className="bg-[#87A96B] hover:bg-[#7a9860] text-white">
                    Schedule Inspection
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
