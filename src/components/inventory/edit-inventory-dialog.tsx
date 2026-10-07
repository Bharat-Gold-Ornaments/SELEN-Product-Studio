"use client";

import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { InventoryPhotoPicker } from "@/components/inventory/inventory-photo-picker";
import { INVENTORY_CATEGORIES } from "@/lib/constants";
import { useUpdateInventoryItem } from "@/hooks/use-inventory";
import type { InventoryCategory, InventoryItem } from "@/types/inventory";

interface EditInventoryDialogProps {
  item: InventoryItem;
  onClose: () => void;
}

export function EditInventoryDialog({ item, onClose }: EditInventoryDialogProps) {
  const [sku, setSku] = useState(item.sku);
  const [category, setCategory] = useState<InventoryCategory>(item.category);
  const [weightGrams, setWeightGrams] = useState(String(item.weightGrams));
  const [quantity, setQuantity] = useState(String(item.quantity));
  const [shopifyProductId, setShopifyProductId] = useState(item.shopifyProductId);
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoRemoved, setPhotoRemoved] = useState(false);

  const update = useUpdateInventoryItem();

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmedSku = sku.trim();
    if (!trimmedSku) {
      toast.error("Enter a SKU.");
      return;
    }
    if (!(Number(weightGrams) > 0)) {
      toast.error("Enter a weight greater than 0.");
      return;
    }
    if (!Number.isInteger(Number(quantity)) || Number(quantity) < 0) {
      toast.error("Enter a quantity of 0 or more.");
      return;
    }

    try {
      await update.mutateAsync({
        sku: item.sku,
        newSku: trimmedSku !== item.sku ? trimmedSku : undefined,
        category,
        weightGrams: Number(weightGrams),
        quantity: Number(quantity),
        shopifyProductId: shopifyProductId.trim(),
        photo: photo ?? undefined,
        removePhoto: photoRemoved,
      });
      toast.success(`${trimmedSku} updated`);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't update this item.");
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto rounded-2xl border border-border bg-card p-6 shadow-xl">
        <DialogTitle>Edit {item.sku}</DialogTitle>
        <form onSubmit={handleSubmit} className="mt-4 grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <Label htmlFor="editSku" className="mb-1.5 block text-sm font-normal">
              SKU
            </Label>
            <Input id="editSku" value={sku} onChange={(e) => setSku(e.target.value)} />
          </div>
          <div className="col-span-2">
            <Label htmlFor="editCategory" className="mb-1.5 block text-sm font-normal">
              Category
            </Label>
            <Select value={category} onValueChange={(v) => setCategory(v as InventoryCategory)}>
              <SelectTrigger id="editCategory">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {INVENTORY_CATEGORIES.map((c) => (
                  <SelectItem key={c.value} value={c.value}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="editWeight" className="mb-1.5 block text-sm font-normal">
              Weight (g)
            </Label>
            <Input
              id="editWeight"
              type="number"
              inputMode="decimal"
              step="0.001"
              min="0"
              value={weightGrams}
              onChange={(e) => setWeightGrams(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="editQuantity" className="mb-1.5 block text-sm font-normal">
              Quantity
            </Label>
            <Input
              id="editQuantity"
              type="number"
              inputMode="numeric"
              step="1"
              min="0"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
          </div>
          <div className="col-span-2">
            <Label htmlFor="editShopifyId" className="mb-1.5 block text-sm font-normal">
              Shopify product ID (optional)
            </Label>
            <Input
              id="editShopifyId"
              value={shopifyProductId}
              onChange={(e) => setShopifyProductId(e.target.value)}
            />
          </div>
          <div className="col-span-2">
            <Label className="mb-1.5 block text-sm font-normal">Photo</Label>
            <InventoryPhotoPicker
              photo={photo}
              savedUrl={photoRemoved ? undefined : item.photoUrl || undefined}
              onSelect={setPhoto}
              onRemove={() => {
                setPhoto(null);
                setPhotoRemoved(true);
              }}
            />
          </div>
          <div className="col-span-2 mt-2 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={update.isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={update.isPending}>
              {update.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Save
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
