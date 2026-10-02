import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Building2, Edit2 } from "lucide-react";
import { useCollection } from "@/lib/useCollection";
import { COLLECTIONS, mapEstablishment } from "@/lib/firestore";
import type { Establishment } from "@/lib/models";
import { useState } from "react";
import { AddEstablishmentModal } from "@/components/AddEstablishmentModal";

export function Establishments() {
  const { data, isLoading, error } = useCollection(COLLECTIONS.establishments, mapEstablishment);
  const establishments = data ?? [];
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedEstablishment, setSelectedEstablishment] = useState<Establishment | null>(null);

  const handleOpenModal = (establishment?: Establishment) => {
    setSelectedEstablishment(establishment || null);
    setIsModalOpen(true);
  };

  return (
    <div className="flex flex-col h-full gap-6">
      <div className="flex items-center justify-between flex-shrink-0">
        <div>
          <h2 className="font-bold text-slate-900 text-2xl tracking-tight">Establishments</h2>
          <p className="text-muted-foreground mt-1 text-sm font-medium">Manage all registered establishments</p>
        </div>
        <Button onClick={() => handleOpenModal()} className="bg-primary hover:bg-primary/90 text-primary-foreground font-bold shadow-sm">
          Add Establishment
        </Button>
      </div>

      <Card className="flex-1 overflow-hidden flex flex-col bg-white rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] border-border">
        {isLoading ? (
          <div className="p-12 text-center my-auto">
            <div className="w-8 h-8 border-4 border-primary/30 border-t-primary rounded-full animate-spin mx-auto" />
            <p className="text-sm text-muted-foreground font-medium mt-4">Loading establishments...</p>
          </div>
        ) : error ? (
          <div className="p-12 text-center my-auto">
            <p className="text-muted-foreground font-bold">Couldn't load establishments.</p>
            <p className="text-sm text-muted-foreground font-medium mt-1">Check your connection — this list is read live from the server.</p>
          </div>
        ) : establishments.length === 0 ? (
          <div className="p-12 text-center my-auto">
            <p className="text-muted-foreground font-bold">No establishments yet.</p>
            <p className="text-sm text-muted-foreground font-medium mt-1">Add one to get started.</p>
          </div>
        ) : (
          <div className="flex-1 overflow-auto min-h-0">
            {/* [REF: ESTABLISHMENT_LIST] */}
            <table className="w-full text-left border-collapse">
              <thead className="sticky top-0 bg-white z-10 shadow-sm border-b border-border">
                <tr>
                  <th className="py-3 px-6 text-[10px] font-extrabold tracking-wider text-slate-500 uppercase">Establishment</th>
                  <th className="py-3 px-6 text-[10px] font-extrabold tracking-wider text-slate-500 uppercase">Category</th>
                  <th className="py-3 px-6 text-[10px] font-extrabold tracking-wider text-slate-500 uppercase">Owner</th>
                  <th className="py-3 px-6 text-[10px] font-extrabold tracking-wider text-slate-500 uppercase">Permit No.</th>
                  <th className="py-3 px-6 text-[10px] font-extrabold tracking-wider text-slate-500 uppercase hidden md:table-cell">Reg. Date</th>
                  <th className="py-3 px-6 text-[10px] font-extrabold tracking-wider text-slate-500 uppercase text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {establishments.map((establishment) => (
                  <tr key={establishment.id} className="hover:bg-slate-50 transition-colors group">
                    <td className="py-4 px-6">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-indigo-50 flex items-center justify-center flex-shrink-0 border border-indigo-100">
                          <Building2 className="w-4 h-4 text-indigo-600" />
                        </div>
                        <span className="font-bold text-slate-900 text-sm">{establishment.business_name}</span>
                      </div>
                    </td>
                    <td className="py-4 px-6 text-sm text-slate-600 font-medium">
                      {establishment.category || establishment.category_id ? (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-slate-100 text-slate-700">
                          {establishment.category || establishment.category_id}
                        </span>
                      ) : (
                        <span className="text-slate-400">-</span>
                      )}
                    </td>
                    <td className="py-4 px-6 text-sm text-slate-700 font-medium">
                      {establishment.owner_name || <span className="text-slate-400">N/A</span>}
                    </td>
                    <td className="py-4 px-6 text-sm text-slate-700 font-medium">
                      {establishment.sanitary_permit_no || <span className="text-slate-400">N/A</span>}
                    </td>
                    <td className="py-4 px-6 text-sm text-slate-600 font-medium hidden md:table-cell">
                      {establishment.created_at ? new Date(establishment.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : <span className="text-slate-400">N/A</span>}
                    </td>
                    <td className="py-4 px-6 text-right">
                      <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity focus-within:opacity-100">
                        <Button variant="outline" size="icon" onClick={() => handleOpenModal(establishment)} className="h-8 w-8 border-border text-slate-600 hover:text-indigo-600 hover:bg-indigo-50 hover:border-indigo-200 shadow-sm" title="Edit Establishment">
                          <Edit2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <AddEstablishmentModal
        open={isModalOpen}
        onOpenChange={setIsModalOpen}
        establishmentToEdit={selectedEstablishment}
      />
    </div>
  );
}
