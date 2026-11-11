import { useState, useEffect, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { COLLECTIONS, mapCategory, saveEstablishment } from "@/lib/dataAccess";
import { useCollection } from "@/lib/useCollection";
import type { Category, Establishment } from "@/lib/models";
import psgcData from "@/lib/data/batangas_psgc.json";

interface AddEstablishmentModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  establishmentToEdit?: Establishment | null;
  onSave?: () => void;
}

export function AddEstablishmentModal({ open, onOpenChange, establishmentToEdit, onSave }: AddEstablishmentModalProps) {
  const [businessName, setBusinessName] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [permitNo, setPermitNo] = useState("");
  const [controlNo, setControlNo] = useState("");
  const [category, setCategory] = useState("Food");
  const [categoryId, setCategoryId] = useState<string>("1");
  const [barangay, setBarangay] = useState("");
  const [street, setStreet] = useState("");
  // Where an emailed copy of a Sanitary Order goes. Usually filled by the
  // inspector on the phone at inspection time — this is the desk-side way to
  // correct a typo, which matters because a wrong address silently sends a
  // legal notice to a stranger.
  const [pointPersonName, setPointPersonName] = useState("");
  const [pointPersonEmail, setPointPersonEmail] = useState("");
  
  const [loading, setLoading] = useState(false);

  // Categories come live from the database. The fallback covers a project whose
  // `categories` collection has not been seeded yet, so the form still offers a
  // usable choice instead of an empty dropdown. Memoised so its identity stays
  // stable — the reset effect below lists it as a dependency.
  const { data: remoteCategories } = useCollection(COLLECTIONS.categories, mapCategory);
  const categories = useMemo<Category[]>(
    () =>
      remoteCategories && remoteCategories.length > 0
        ? remoteCategories
        : [{ id: "1", name: "Food", icon_name: null, created_at: null }],
    [remoteCategories],
  );

  useEffect(() => {
    if (open) {
      if (establishmentToEdit) {
        setBusinessName(establishmentToEdit.business_name || "");
        setOwnerName(establishmentToEdit.owner_name || "");
        setPermitNo(establishmentToEdit.sanitary_permit_no || "");
        setControlNo(establishmentToEdit.control_no || "");
        setPointPersonName(establishmentToEdit.point_person_name || "");
        setPointPersonEmail(establishmentToEdit.point_person_email || "");
        
        let existingBarangay = "";
        let existingStreet = "";
        
        try {
          // New structured schema
          if (typeof establishmentToEdit.address === "object" && establishmentToEdit.address !== null) {
            existingBarangay = establishmentToEdit.address.barangay || "";
            existingStreet = establishmentToEdit.address.street || "";
          } else if (typeof establishmentToEdit.address === "string") {
            const parsed = JSON.parse(establishmentToEdit.address);
            existingBarangay = parsed.barangay || "";
            existingStreet = parsed.street || "";
          }
        } catch (e) {
          // Legacy string fallback
          if (establishmentToEdit.address && establishmentToEdit.address !== "N/A") {
            existingStreet = establishmentToEdit.address;
          }
        }
        
        // Use the dedicated barangay column if present
        if (!existingBarangay && establishmentToEdit.barangay) {
          existingBarangay = establishmentToEdit.barangay;
        }

        setBarangay(existingBarangay);
        setStreet(existingStreet);
        
        if (establishmentToEdit.category_id) {
          setCategoryId(establishmentToEdit.category_id);
          const matchedCat = categories.find(c => c.id === establishmentToEdit.category_id);
          if (matchedCat) setCategory(matchedCat.name);
        }
      } else {
        setBusinessName("");
        setOwnerName("");
        setPermitNo("");
        setControlNo("");
        setPointPersonName("");
        setPointPersonEmail("");
        if (categories.length > 0) {
          setCategory(categories[0].name);
          setCategoryId(categories[0].id);
        } else {
          setCategory("Food");
          setCategoryId("1");
        }
        setBarangay("");
        setStreet("");
      }
    }
  }, [open, establishmentToEdit, categories]);

  // [REF: ESTABLISHMENT_FORM_SAVE]
  const handleSave = async () => {
    if (!businessName.trim() || !barangay) {
      toast.error("Business Name and Barangay are required.");
      return;
    }

    setLoading(true);
    try {
      const addressPayload = {
        province: psgcData.province,
        city: psgcData.city,
        barangay: barangay,
        street: street.trim(),
        fullAddress: street.trim() ? `${street.trim()}, ${barangay}, ${psgcData.city}, ${psgcData.province}` : `${barangay}, ${psgcData.city}, ${psgcData.province}`
      };

      const payload: Partial<Establishment> = {
        business_name: businessName.trim(),
        owner_name: ownerName.trim() || null,
        address: addressPayload,
        barangay: barangay,
        sanitary_permit_no: permitNo.trim() || null,
        control_no: controlNo.trim() || null,
        point_person_name: pointPersonName.trim() || null,
        // Lower-cased as well as trimmed: this is an address that gets matched
        // and de-duplicated, and "Juan@x.com" and "juan@x.com" are one inbox.
        // Blank becomes null, never "" — the delivery function selects on
        // `point_person_email is not null`, which an empty string would pass.
        point_person_email: pointPersonEmail.trim().toLowerCase() || null,
        category_id: categoryId,
        category: category,
      };

      // Written straight to Postgres. There is no local queue behind this: if
      // the write throws, nothing was saved anywhere and the dialog stays open
      // with the user's input intact so they can retry.
      if (establishmentToEdit) {
        await saveEstablishment(establishmentToEdit.id, payload);
      } else {
        await saveEstablishment(null, {
          ...payload,
          created_at: new Date().toISOString(),
          personnel_count: 0,
          personnel_with_hc: 0,
          qr_code_id: null,
        });
      }

      toast.success(establishmentToEdit ? "Establishment updated." : "Establishment added.");
      onOpenChange(false);
      if (onSave) onSave();
    } catch (error: any) {
      console.error("Failed to save establishment", error);
      toast.error(
        navigator.onLine
          ? error?.message || "Failed to save establishment."
          : "You are offline — connect to the internet to save.",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{establishmentToEdit ? "Edit Establishment" : "Add Establishment"}</DialogTitle>
        </DialogHeader>
        
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="name">Business Name *</Label>
            <Input id="name" value={businessName} onChange={(e) => setBusinessName(e.target.value)} placeholder="Enter business name" />
          </div>
          
          <div className="grid gap-2">
            <Label htmlFor="owner">Owner / Manager</Label>
            <Input id="owner" value={ownerName} onChange={(e) => setOwnerName(e.target.value)} placeholder="Enter owner's name" />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="category">Category *</Label>
            <Select 
              value={categoryId} 
              onValueChange={(val) => {
                setCategoryId(val);
                const matchedCat = categories.find(c => c.id === val);
                if (matchedCat) setCategory(matchedCat.name);
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select Category" />
              </SelectTrigger>
              <SelectContent>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="border-t pt-4 mt-2">
            <h4 className="text-sm font-semibold mb-3">Address Location</h4>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div className="grid gap-2">
                <Label>Province</Label>
                <Input value={psgcData.province} disabled className="bg-slate-50 text-slate-500" />
              </div>
              <div className="grid gap-2">
                <Label>City / Municipality</Label>
                <Input value={psgcData.city} disabled className="bg-slate-50 text-slate-500" />
              </div>
            </div>

            <div className="grid gap-2 mb-4">
              <Label htmlFor="barangay">Barangay *</Label>
              <Select value={barangay} onValueChange={setBarangay}>
                <SelectTrigger>
                  <SelectValue placeholder="Select Barangay" />
                </SelectTrigger>
                <SelectContent>
                  {psgcData.barangays.map((b) => (
                    <SelectItem key={b} value={b}>{b}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="street">Street / House No. / Landmark</Label>
              <Input id="street" value={street} onChange={(e) => setStreet(e.target.value)} placeholder="e.g. 123 Main St" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 mt-2">
            <div className="grid gap-2">
              <Label htmlFor="permit">Sanitary Permit No.</Label>
              <Input id="permit" value={permitNo} onChange={(e) => setPermitNo(e.target.value)} placeholder="Optional" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="control">Control No.</Label>
              <Input id="control" value={controlNo} onChange={(e) => setControlNo(e.target.value)} placeholder="Optional" />
            </div>
          </div>

          {/* Sanitary Order recipient. Kept next to the permit numbers rather
              than with the address: it identifies a person to notify, not a
              place to find. */}
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="pointPerson">Point Person</Label>
              <Input
                id="pointPerson"
                value={pointPersonName}
                onChange={(e) => setPointPersonName(e.target.value)}
                placeholder="Optional"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="pointPersonEmail">Point Person Email</Label>
              <Input
                id="pointPersonEmail"
                type="email"
                value={pointPersonEmail}
                onChange={(e) => setPointPersonEmail(e.target.value)}
                placeholder="For Sanitary Order copies"
              />
            </div>
          </div>
        </div>
        
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>Cancel</Button>
          <Button onClick={handleSave} disabled={loading}>
            {loading ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
