import { useState } from "react";
import { Card } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "../components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { User, Mail, Phone, ClipboardCheck, Award, Plus, Trash2, Pencil } from "lucide-react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, DbInspector } from "../../lib/db";
import { useAuth } from "../../lib/useAuth";
import { toast } from "sonner";

function getStatusColor(status: string) {
  return status === "Active" ? "var(--primary)" : "var(--muted-foreground)";
}

function getPerformanceColor(performance: string) {
  switch (performance) {
    case "Excellent": return "var(--primary)";
    case "Good": return "#F59E0B";
    default: return "var(--muted-foreground)";
  }
}

const EMPTY_FORM = {
  name: "",
  inspectorId: "",
  email: "",
  phone: "",
  status: "Active",
  performance: "Good",
};

export function Inspectors() {
  const inspectors = useLiveQuery(() => db.inspectors.toArray()) ?? [];
  const activeCount = inspectors.filter(i => i.status === "Active").length;
  const todayInspections = inspectors.reduce((acc, curr) => acc + (curr.completedToday || 0), 0);
  const { role } = useAuth();
  const isAdmin = role === "admin";

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);

  function openAdd() {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setIsDialogOpen(true);
  }

  function openEdit(inspector: DbInspector) {
    setForm({
      name: inspector.name,
      inspectorId: inspector.inspectorId,
      email: inspector.email,
      phone: inspector.phone,
      status: inspector.status,
      performance: inspector.performance,
    });
    setEditingId(inspector.id);
    setIsDialogOpen(true);
  }

  async function handleSave() {
    if (!form.name || !form.inspectorId || !form.email || !form.phone) {
      toast.error("Please fill in all required fields.");
      return;
    }
    setIsSaving(true);
    try {
      const now = new Date().toISOString();
      if (editingId) {
        await db.inspectors.update(editingId, {
          ...form,
          is_synced: 0,
          updated_at: now,
        });
        toast.success("Inspector updated.");
      } else {
        const newInspector: DbInspector = {
          id: crypto.randomUUID(),
          ...form,
          totalInspections: 0,
          completedToday: 0,
          is_synced: 0,
          updated_at: now,
        };
        await db.inspectors.add(newInspector);
        toast.success("Inspector added.");
      }
      setIsDialogOpen(false);
    } catch (err: any) {
      toast.error(err.message || "Failed to save inspector.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Are you sure you want to delete this inspector?")) return;
    await db.inspectors.delete(id);
    toast.success("Inspector deleted.");
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-bold text-slate-900 text-2xl tracking-tight">Inspectors</h2>
          <p className="text-muted-foreground mt-1">Manage inspection team members</p>
        </div>
        {isAdmin && (
          <Button
            onClick={openAdd}
            className="bg-primary hover:bg-primary/90 text-primary-foreground shadow-sm font-bold"
          >
            <Plus className="w-4 h-4 mr-2" />
            Add Inspector
          </Button>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="p-4 bg-white rounded-xl">
          <p className="text-muted-foreground font-bold text-sm mb-1">Total Inspectors</p>
          <h3 className="font-black text-slate-900 text-2xl">{inspectors.length}</h3>
        </Card>
        <Card className="p-4 bg-white rounded-xl">
          <p className="text-muted-foreground font-bold text-sm mb-1">Active Today</p>
          <h3 className="font-black text-primary text-2xl">{activeCount}</h3>
        </Card>
        <Card className="p-4 bg-white rounded-xl">
          <p className="text-muted-foreground font-bold text-sm mb-1">Inspections Today</p>
          <h3 className="font-black text-slate-900 text-2xl">{todayInspections}</h3>
        </Card>
        <Card className="p-4 bg-white rounded-xl">
          <p className="text-muted-foreground font-bold text-sm mb-1">Avg. Performance</p>
          <h3 className="font-black text-primary text-2xl">
            {inspectors.length > 0 ? "Excellent" : "N/A"}
          </h3>
        </Card>
      </div>

      {/* Inspector List */}
      <div className="grid grid-cols-1 gap-4">
        {inspectors.length === 0 ? (
          <Card className="p-12 bg-white rounded-xl text-center">
            <div className="flex flex-col items-center gap-3">
              <div className="w-14 h-14 rounded-full bg-slate-100 flex items-center justify-center">
                <User className="w-7 h-7 text-slate-400" />
              </div>
              <p className="text-muted-foreground font-bold">No inspectors found.</p>
              {isAdmin && (
                <p className="text-sm text-muted-foreground">
                  Click <strong>Add Inspector</strong> to get started.
                </p>
              )}
            </div>
          </Card>
        ) : (
          inspectors.map((inspector) => (
            <Card key={inspector.id} className="p-6 bg-white rounded-xl hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between">
                <div className="flex gap-4 flex-1">
                  <div className="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center flex-shrink-0">
                    <User className="w-8 h-8 text-primary" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2 flex-wrap">
                      <h3 className="font-bold text-slate-900 text-lg">{inspector.name}</h3>
                      <span className="text-muted-foreground font-medium text-sm">({inspector.inspectorId})</span>
                      <span
                        className="inline-flex items-center px-3 py-1 rounded-full text-xs font-bold border"
                        style={{
                          backgroundColor: `color-mix(in srgb, ${getStatusColor(inspector.status)} 15%, transparent)`,
                          color: getStatusColor(inspector.status),
                          borderColor: `color-mix(in srgb, ${getStatusColor(inspector.status)} 30%, transparent)`
                        }}
                      >
                        {inspector.status}
                      </span>
                      <span
                        className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold border"
                        style={{
                          backgroundColor: `color-mix(in srgb, ${getPerformanceColor(inspector.performance)} 15%, transparent)`,
                          color: getPerformanceColor(inspector.performance),
                          borderColor: `color-mix(in srgb, ${getPerformanceColor(inspector.performance)} 30%, transparent)`
                        }}
                      >
                        <Award className="w-3 h-3" />
                        {inspector.performance}
                      </span>
                      {inspector.is_synced === 0 && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-amber-50 text-amber-600 border border-amber-200">
                          Pending Sync
                        </span>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm mb-3">
                      <div className="flex items-center gap-2 text-muted-foreground font-medium">
                        <Mail className="w-4 h-4" />
                        <span>{inspector.email}</span>
                      </div>
                      <div className="flex items-center gap-2 text-muted-foreground font-medium">
                        <Phone className="w-4 h-4" />
                        <span>{inspector.phone}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-6 text-sm">
                      <div className="flex items-center gap-2">
                        <ClipboardCheck className="w-4 h-4 text-primary" />
                        <span className="text-slate-600 font-medium">
                          <span className="font-bold text-slate-900">{inspector.totalInspections}</span> total inspections
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-slate-600 font-medium">
                          <span className="font-bold text-primary">{inspector.completedToday}</span> completed today
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
                {isAdmin && (
                  <div className="flex gap-2 flex-shrink-0 ml-4">
                    <Button
                      variant="outline"
                      size="sm"
                      className="border-border hover:bg-slate-50 font-bold"
                      onClick={() => openEdit(inspector)}
                    >
                      <Pencil className="w-4 h-4 mr-1" />
                      Edit
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="border-red-200 text-red-600 hover:bg-red-50 font-bold"
                      onClick={() => handleDelete(inspector.id)}
                    >
                      <Trash2 className="w-4 h-4 mr-1" />
                      Delete
                    </Button>
                  </div>
                )}
              </div>
            </Card>
          ))
        )}
      </div>

      {/* Add / Edit Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-slate-900 font-bold">
              {editingId ? "Edit Inspector" : "Add Inspector"}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="name">Full Name <span className="text-red-500">*</span></Label>
                <Input id="name" placeholder="e.g. Juan Dela Cruz" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="inspectorId">Inspector ID <span className="text-red-500">*</span></Label>
                <Input id="inspectorId" placeholder="e.g. INSP-001" value={form.inspectorId} onChange={e => setForm(f => ({ ...f, inspectorId: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email <span className="text-red-500">*</span></Label>
              <Input id="email" type="email" placeholder="inspector@email.com" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone">Phone <span className="text-red-500">*</span></Label>
              <Input id="phone" placeholder="e.g. 09XX-XXX-XXXX" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Active">Active</SelectItem>
                    <SelectItem value="Inactive">Inactive</SelectItem>
                    <SelectItem value="On Leave">On Leave</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Performance</Label>
                <Select value={form.performance} onValueChange={v => setForm(f => ({ ...f, performance: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Excellent">Excellent</SelectItem>
                    <SelectItem value="Good">Good</SelectItem>
                    <SelectItem value="Needs Improvement">Needs Improvement</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)} disabled={isSaving}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={isSaving} className="bg-primary hover:bg-primary/90 text-primary-foreground font-bold">
              {isSaving ? (
                <div className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin mr-2" />
              ) : null}
              {editingId ? "Save Changes" : "Add Inspector"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
