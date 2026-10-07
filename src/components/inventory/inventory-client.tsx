"use client";

import { useState, type FormEvent } from "react";
import Image from "next/image";
import { toast } from "sonner";
import { ImageOff, Loader2, Pencil, Plus, RefreshCw, TriangleAlert } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { InventoryPhotoPicker } from "@/components/inventory/inventory-photo-picker";
import { EditInventoryDialog } from "@/components/inventory/edit-inventory-dialog";
import { INVENTORY_CATEGORIES } from "@/lib/constants";
import { cn, formatDate, formatGrams } from "@/lib/utils";
import { useAddInventoryItem, useInventory } from "@/hooks/use-inventory";
import type { InventoryCategory, InventoryItem } from "@/types/inventory";

const CATEGORY_LABEL = Object.fromEntries(INVENTORY_CATEGORIES.map((c) => [c.value, c.label])) as Record<
  InventoryCategory,
  string
>;

export function InventoryClient() {
  const [sku, setSku] = useState("");
  const [category, setCategory] = useState<InventoryCategory | "">("");
  const [weightGrams, setWeightGrams] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [shopifyProductId, setShopifyProductId] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);

  const { data: items, isLoading, isError, error, refetch, isFetching } = useInventory();
  const addItem = useAddInventoryItem();
  const [editing, setEditing] = useState<InventoryItem | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!sku.trim()) {
      toast.error("Enter a SKU.");
      return;
    }
    if (!category) {
      toast.error("Pick a category.");
      return;
    }
    if (!(Number(weightGrams) > 0)) {
      toast.error("Enter a weight greater than 0.");
      return;
    }
    if (!Number.isInteger(Number(quantity)) || Number(quantity) < 1) {
      toast.error("Enter a quantity of 1 or more.");
      return;
    }

    try {
      await addItem.mutateAsync({
        sku: sku.trim(),
        category,
        weightGrams,
        quantity,
        shopifyProductId: shopifyProductId.trim(),
        photo,
      });
      toast.success(`${sku.trim()} added to inventory`);
      // Category is kept so a run of same-category pieces doesn't need it re-picked each time.
      setSku("");
      setWeightGrams("");
      setQuantity("1");
      setShopifyProductId("");
      setPhoto(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save this item.");
    }
  }

  // Sorted by SKU, with number-aware ordering so R-2 comes before R-10. The
  // sheet itself stays in append order.
  const rows = items
    ? [...items].sort((a, b) => a.sku.localeCompare(b.sku, undefined, { numeric: true, sensitivity: "base" }))
    : [];

  return (
    <div className="flex flex-1 flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Add item</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <div>
              <Label htmlFor="sku" className="mb-1.5 block text-sm font-normal">
                SKU
              </Label>
              <Input
                id="sku"
                placeholder="e.g. R-1042"
                value={sku}
                onChange={(e) => setSku(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="inventoryCategory" className="mb-1.5 block text-sm font-normal">
                Category
              </Label>
              <Select value={category} onValueChange={(v) => setCategory(v as InventoryCategory)}>
                <SelectTrigger id="inventoryCategory">
                  <SelectValue placeholder="Select category" />
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
              <Label htmlFor="weightGrams" className="mb-1.5 block text-sm font-normal">
                Weight (g)
              </Label>
              <Input
                id="weightGrams"
                type="number"
                inputMode="decimal"
                step="0.001"
                min="0"
                placeholder="e.g. 3.25"
                value={weightGrams}
                onChange={(e) => setWeightGrams(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="quantity" className="mb-1.5 block text-sm font-normal">
                Quantity
              </Label>
              <Input
                id="quantity"
                type="number"
                inputMode="numeric"
                step="1"
                min="1"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="shopifyProductId" className="mb-1.5 block text-sm font-normal">
                Shopify product ID (optional)
              </Label>
              <Input
                id="shopifyProductId"
                placeholder="If already on Shopify"
                value={shopifyProductId}
                onChange={(e) => setShopifyProductId(e.target.value)}
              />
            </div>

            <div className="sm:col-span-2 lg:col-span-5">
              <Label className="mb-1.5 block text-sm font-normal">Photo</Label>
              <InventoryPhotoPicker photo={photo} onSelect={setPhoto} onRemove={() => setPhoto(null)} />
            </div>

            <div className="sm:col-span-2 lg:col-span-5">
              <Button type="submit" disabled={addItem.isPending}>
                {addItem.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                Add to inventory
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {isError ? (
        <div className="flex flex-col items-start justify-between gap-3 rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm sm:flex-row sm:items-center">
          <span className="flex items-center gap-2 text-destructive">
            <TriangleAlert className="h-4 w-4 shrink-0" />
            {error instanceof Error ? error.message : "Couldn't load inventory."}
          </span>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            {isFetching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Retry
          </Button>
        </div>
      ) : null}

      <div>
        <p className="mb-3 text-sm font-medium text-foreground">
          {isLoading ? "Loading inventory…" : `${rows.length} item${rows.length === 1 ? "" : "s"} in inventory`}
        </p>

        <Card className="overflow-hidden p-0">
          {isLoading ? (
            <div className="flex flex-col gap-3 p-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full rounded-lg" />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
              No items yet — add one above.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
                    <th className="px-4 py-2.5 font-medium">Photo</th>
                    <th className="px-4 py-2.5 font-medium">SKU</th>
                    <th className="px-4 py-2.5 font-medium">Category</th>
                    <th className="px-4 py-2.5 text-right font-medium">Weight</th>
                    <th className="px-4 py-2.5 text-right font-medium">Qty</th>
                    <th className="px-4 py-2.5 font-medium">Shopify ID</th>
                    <th className="px-4 py-2.5 font-medium">Added</th>
                    <th className="px-4 py-2.5">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((item) => (
                    <tr key={item.sku}>
                      <td className="px-4 py-2">
                        <div className="relative flex h-12 w-12 items-center justify-center overflow-hidden rounded-lg bg-muted">
                          {item.photoUrl ? (
                            <a href={item.photoUrl} target="_blank" rel="noreferrer">
                              <Image src={item.photoUrl} alt={item.sku} fill unoptimized className="object-cover" />
                            </a>
                          ) : (
                            <ImageOff className="h-4 w-4 text-muted-foreground" />
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-2 font-medium text-foreground">{item.sku}</td>
                      <td className="px-4 py-2">
                        <Badge variant="secondary">{CATEGORY_LABEL[item.category] ?? item.category}</Badge>
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">{formatGrams(item.weightGrams)}</td>
                      <td
                        className={cn("px-4 py-2 text-right tabular-nums", item.quantity === 0 && "text-destructive")}
                      >
                        {item.quantity}
                      </td>
                      <td className="px-4 py-2 text-muted-foreground">{item.shopifyProductId || "—"}</td>
                      <td className="px-4 py-2 text-muted-foreground">
                        {item.createdDate ? formatDate(item.createdDate) : "—"}
                      </td>
                      <td className="px-4 py-2 text-right">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => setEditing(item)}
                          aria-label={`Edit ${item.sku}`}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      {editing ? <EditInventoryDialog item={editing} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}
