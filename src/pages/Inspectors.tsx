import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { User, Mail, Phone, ClipboardCheck, Award, Plus, Trash2, Pencil } from "lucide-react";
import { useCollection } from "@/lib/useCollection";
import {
  COLLECTIONS,
  deleteInspector,
  mapInspectionLog,
  mapInspector,
  mapProfile,
  saveInspector,
} from "@/lib/firestore";
import type { Inspector } from "@/lib/models";
import { useAuth } from "@/lib/useAuth";
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

// Synthetic rows (accounts and log-only inspectors) aren't documents in the
// `inspectors` directory, so they can't be edited or deleted in place — the
// admin can promote one into the directory instead.
function isDirectoryEntry(inspector: Inspector): boolean {
  return !inspector.id.startsWith("profile:") && !inspector.id.startsWith("log:");
}

// [REF: INSPECTOR_DIRECTORY]
//
// The list shown here is a merge of every place a real inspector can exist:
//  1. the admin-curated `inspectors` directory,
//  2. officer accounts in `profiles` — only that role, since the table also
//     holds admins, unactivated 'pending' signups and establishment owners
//     (readable by admins only — a permission error on that source just means
//     it's unavailable, not that the page failed), and
//  3. names found on submitted `inspection_logs`.
// Inspection counts are always derived live from the logs, because no client
// keeps the directory's counter fields up to date.
export function Inspectors() {
  const { data, error } = useCollection(COLLECTIONS.inspectors, mapInspector);
  const { data: profiles } = useCollection(COLLECTIONS.profiles, mapProfile);
  const { data: logs } = useCollection(COLLECTIONS.inspectionLogs, mapInspectionLog);

  const inspectors = useMemo(() => {
    const directory = data ?? [];
    const today = new Date();
    const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

    // Per-inspector activity, keyed by the normalised `inspector_name` the
    // mobile client stamps on each log (displayName, falling back to email).
    const stats = new Map<string, { name: string; total: number; today: number }>();
    for (const log of logs ?? []) {
      const name = (log.inspector_name ?? "").trim();
      if (!name) continue;
      const key = name.toLowerCase();
      const s = stats.get(key) ?? { name, total: 0, today: 0 };
      s.total += 1;
      if (log.inspection_date?.startsWith(todayKey)) s.today += 1;
      stats.set(key, s);
    }
    const claimStats = (...candidates: (string | null | undefined)[]) => {
      for (const c of candidates) {
        const key = c?.trim().toLowerCase();
        if (!key) continue;
        const s = stats.get(key);
        if (s) {
          stats.delete(key);
          return s;
        }
      }
      return null;
    };

    const merged: Inspector[] = [];
    const seenEmails = new Set<string>();

    for (const d of directory) {
      if (d.email) seenEmails.add(d.email.trim().toLowerCase());
      const s = claimStats(d.name, d.email);
      merged.push({
        ...d,
        // Live off the logs, never the stored columns — same as the two
        // branches below. `Math.max(s.total, d.totalInspections)` used to sit
        // here, which meant a stale directory counter outranked the real
        // count and could only ever climb: handleSave wrote the displayed
        // figure back, so each edit cemented the high-water mark.
        totalInspections: s?.total ?? 0,
        completedToday: s?.today ?? 0,
      });
    }

    // Registered mobile accounts that aren't in the directory yet.
    for (const p of profiles ?? []) {
      // Officers only, and tested positively on purpose. The old
      // `=== "admin"` skip admitted everything else, so once 'pending' and
      // 'owner' became real roles an unactivated account and an
      // establishment's point person both surfaced here as inspectors — and
      // any role a later migration adds would too.
      if (p.role !== "officer") continue;
      const email = p.email.trim().toLowerCase();
      if (!email || seenEmails.has(email)) continue;
      seenEmails.add(email);
      const s = claimStats(p.email, p.email.split("@")[0]);
      merged.push({
        id: `profile:${p.id}`,
        name: s?.name ?? p.email.split("@")[0],
        inspectorId: "Registered account",
        email: p.email,
        phone: "—",
        status: "Active",
        performance: "Unrated",
        totalInspections: s?.total ?? 0,
        completedToday: s?.today ?? 0,
        updated_at: p.created_at ?? "",
      });
    }

    // Inspectors who only exist as names on submitted logs.
    for (const [key, s] of stats) {
      merged.push({
        id: `log:${key}`,
        name: s.name,
        inspectorId: "From inspection records",
        email: s.name.includes("@") ? s.name : "—",
        phone: "—",
        status: "Active",
        performance: "Unrated",
        totalInspections: s.total,
        completedToday: s.today,
        updated_at: "",
      });
    }

    return merged;
  }, [data, profiles, logs]);

  const activeCount = inspectors.filter(i => i.status === "Active").length;
  const todayInspections = inspectors.reduce((acc, curr) => acc + (curr.completedToday || 0), 0);
  // Most common performance rating across the team — computed from the real
  // per-inspector `performance` field, not a hard-coded label.
  const typicalPerformance = (() => {
    const counts = new Map<string, number>();
    for (const i of inspectors) {
      if (i.performance && i.performance !== "Unrated") {
        counts.set(i.performance, (counts.get(i.performance) ?? 0) + 1);
      }
    }
    let best: string | null = null;
    for (const [label, count] of counts) {
      if (best === null || count > (counts.get(best) ?? 0)) best = label;
    }
    return best;
  })();
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

  // Promote a synthetic row (registered account / log-only name) into a real
  // directory document: an "add" prefilled with what we already know.
  function openAddFrom(inspector: Inspector) {
    setForm({
      ...EMPTY_FORM,
      name: inspector.name,
      email: inspector.email === "—" ? "" : inspector.email,
    });
    setEditingId(null);
    setIsDialogOpen(true);
  }

  function openEdit(inspector: Inspector) {
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
      // Inspection counters belong to the inspection flow, not to this form:
      // carry the STORED values through so an edit neither zeroes them nor
      // rewrites them. Read from `data` (the raw directory) and not from
      // `inspectors` — those rows carry the live log-derived counts, and
      // writing one of those back is what made the stored counter a ratchet.
      const existing = editingId ? (data ?? []).find((i) => i.id === editingId) : null;

      await saveInspector(editingId, {
        ...form,
        totalInspections: existing?.totalInspections ?? 0,
        completedToday: existing?.completedToday ?? 0,
      });

      toast.success(editingId ? "Inspector updated." : "Inspector added.");
      setIsDialogOpen(false);
    } catch (err: any) {
      toast.error(err?.message || "Failed to save inspector.");
    } finally {
      setIsSaving(false);
    }
  }

  const [deleteTarget, setDeleteTarget] = useState<Inspector | null>(null);

  async function handleDelete() {
    if (!deleteTarget) return;
    try {
      await deleteInspector(deleteTarget.id);
      toast.success("Inspector deleted.");
      setDeleteTarget(null);
    } catch (err: any) {
      toast.error(err?.message || "Failed to delete inspector.");
    }
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
          <p className="text-muted-foreground font-bold text-sm mb-1">Typical Performance</p>
          <h3 className="font-black text-primary text-2xl">
            {typicalPerformance ?? "N/A"}
          </h3>
        </Card>
      </div>

      {/* Inspector List */}
      <div className="grid grid-cols-1 gap-4">
        {error ? (
          <Card className="p-12 bg-white rounded-xl text-center">
            <div className="flex flex-col items-center gap-3">
              <div className="w-14 h-14 rounded-full bg-amber-50 flex items-center justify-center">
                <User className="w-7 h-7 text-amber-500" />
              </div>
              <p className="text-muted-foreground font-bold">Couldn't load the inspector list.</p>
              <p className="text-sm text-muted-foreground">
                This directory is read live from the server — check your connection.
              </p>
            </div>
          </Card>
        ) : inspectors.length === 0 ? (
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
                    {isDirectoryEntry(inspector) ? (
                      <>
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
                          onClick={() => setDeleteTarget(inspector)}
                        >
                          <Trash2 className="w-4 h-4 mr-1" />
                          Delete
                        </Button>
                      </>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        className="border-border hover:bg-slate-50 font-bold"
                        onClick={() => openAddFrom(inspector)}
                      >
                        <Plus className="w-4 h-4 mr-1" />
                        Add to directory
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </Card>
          ))
        )}
      </div>

      {/* Add / Edit Dialog */}
      <Dialog open={deleteTarget !== null} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-slate-900 font-bold">Delete inspector?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-slate-600">
            <span className="font-bold text-slate-900">{deleteTarget?.name}</span> will be removed from the directory. This cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button className="bg-red-600 hover:bg-red-700 text-white" onClick={handleDelete}>
              <Trash2 className="w-4 h-4 mr-1" />
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
