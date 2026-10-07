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
import { INVENTORY_CATEGORIES } from "@/lib/constants";
import { useUpdateInventoryItem } from "@/hooks/use-inventory";
import type { InventoryCategory, InventoryItem } from "@/types/inventory";

interface EditInventoryDialogProps {
  item: InventoryItem;
  onClose: () => void;
}

/** SKU isn't editable — it's how the row is found in the sheet. */
export function EditInventoryDialog({ item, onClose }: EditInventoryDialogProps) {
  const [category, setCategory] = useState<InventoryCategory>(item.category);
  const [weightGrams, setWeightGrams] = useState(String(item.weightGrams));
  const [quantity, setQuantity] = useState(String(item.quantity));
  const [shopifyProductId, setShopifyProductId] = useState(item.shopifyProductId);

  const update = useUpdateInventoryItem();

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
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
        category,
        weightGrams: Number(weightGrams),
        quantity: Number(quantity),
        shopifyProductId: shopifyProductId.trim(),
      });
      toast.success(`${item.sku} updated`);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't update this item.");
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md rounded-2xl border border-border bg-card p-6 shadow-xl">
        <DialogTitle>Edit {item.sku}</DialogTitle>
        <form onSubmit={handleSubmit} className="mt-4 grid grid-cols-2 gap-4">
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
