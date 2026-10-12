"use client";

import { useState, type FormEvent } from "react";
import Image from "next/image";
import { toast } from "sonner";
import { ImageOff, Loader2, PackagePlus, Plus, Sparkles, TriangleAlert } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { InventoryPhotoPicker } from "@/components/inventory/inventory-photo-picker";
import {
  EMPTY_PRICING_DRAFT,
  PricingFields,
  draftToInventoryPricing,
  pricingState,
  type PricingDraft,
} from "@/components/pricing/pricing-fields";
import { useAppSettings } from "@/hooks/use-settings";
import { ItemPicker } from "@/components/sales/item-picker";
import { useRecordedBy } from "@/components/sales/use-recorded-by";
import { useAddInventoryItem, useRestockItem } from "@/hooks/use-inventory";
import { INVENTORY_CATEGORIES } from "@/lib/constants";
import { similarItems } from "@/lib/inventory-duplicates";
import { localDate } from "@/lib/sales-stats";
import { formatGrams } from "@/lib/utils";
import type { InventoryCategory, InventoryItem } from "@/types/inventory";

type Mode = "restock" | "new";

function ItemSummary({ item }: { item: InventoryItem }) {
  return (
    <div className="flex items-center gap-3">
      <div className="relative flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted">
        {item.photoUrl ? (
          <Image src={item.photoUrl} alt={item.sku} fill unoptimized className="object-cover" />
        ) : (
          <ImageOff className="h-4 w-4 text-muted-foreground" />
        )}
      </div>
      <div className="flex flex-col">
        <span className="text-sm font-semibold text-foreground">{item.sku}</span>
        <span className="text-xs text-muted-foreground">
          {formatGrams(item.weightGrams)} · {item.quantity} in stock now
        </span>
      </div>
    </div>
  );
}

/**
 * Adding stock. Restock (the default) adds pieces to a design that's
 * already in Inventory and can never create a row. "Add new design" is the
 * exception: it needs a photo, and if pieces in the same category weigh
 * within ±5% it asks "Is it one of these?" before saving — the usual way a
 * design ends up under two SKUs is staff not recognising it.
 */
export function AddStockCard({ items }: { items: InventoryItem[] }) {
  const [mode, setMode] = useState<Mode>("restock");
  const [recordedBy, setRecordedBy] = useRecordedBy();

  // Restock
  const [selected, setSelected] = useState<InventoryItem | null>(null);
  const [restockQuantity, setRestockQuantity] = useState("1");
  const restock = useRestockItem();

  // New design
  const [sku, setSku] = useState("");
  const [category, setCategory] = useState<InventoryCategory | "">("");
  const [weightGrams, setWeightGrams] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [shopifyProductId, setShopifyProductId] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [confirmedNew, setConfirmedNew] = useState(false);
  const [pricingDraft, setPricingDraft] = useState<PricingDraft>(EMPTY_PRICING_DRAFT);
  const addItem = useAddInventoryItem();
  const ratePerGram = useAppSettings().data?.ratePerGram ?? 0;
  // The Weight field above is the gross weight the price is based on.
  const draft = { ...pricingDraft, grossWeight: weightGrams };
  const pricing = pricingState(draft, ratePerGram);
  const pricingReady = !pricing.validationError && (!draft.manualOverride || pricing.overridePriceNumber > 0);

  const weight = Number(weightGrams);
  const similar = category && weight > 0 ? similarItems(items, category, weight) : [];
  // Re-ask whenever the details that decide the matches change.
  const confirmationKey = `${category}|${weightGrams}`;
  const [confirmedFor, setConfirmedFor] = useState("");
  const isConfirmed = confirmedNew && confirmedFor === confirmationKey;

  // Keep the selected item's quantity current after a save refetches the list.
  const current = selected ? (items.find((i) => i.sku === selected.sku) ?? selected) : null;

  function chooseForRestock(item: InventoryItem, carryQuantity?: string) {
    setSelected(item);
    setRestockQuantity(carryQuantity ?? "1");
    setMode("restock");
  }

  async function handleRestock(event: FormEvent) {
    event.preventDefault();
    if (!current) return;
    const count = Number(restockQuantity);
    if (!Number.isInteger(count) || count < 1) {
      toast.error("Enter how many arrived — 1 or more.");
      return;
    }
    if (!recordedBy.trim()) {
      toast.error("Enter your name in “Recorded by”.");
      return;
    }
    try {
      const entry = await restock.mutateAsync({ sku: current.sku, quantity: count, recordedBy: recordedBy.trim(), date: localDate() });
      if (entry.shopifyStatus === "pending") {
        toast.warning(`Added ${count} to ${current.sku}, but Shopify couldn't be updated yet — retry from the Sales page.`);
      } else {
        toast.success(`Added ${count} to ${current.sku} — now ${entry.stockAfter} in stock.`);
      }
      setSelected(null);
      setRestockQuantity("1");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't add this stock.");
    }
  }

  async function handleAddNew(event: FormEvent) {
    event.preventDefault();
    if (!sku.trim()) return void toast.error("Enter a SKU.");
    if (!category) return void toast.error("Pick a category.");
    if (!(weight > 0)) return void toast.error("Enter a weight greater than 0.");
    if (!Number.isInteger(Number(quantity)) || Number(quantity) < 1) return void toast.error("Enter a quantity of 1 or more.");
    if (!photo) return void toast.error("Add a photo — it's how staff find the piece later.");
    if (!pricingReady) {
      return void toast.error(pricing.validationError ?? "Enter the manual override price.");
    }
    if (similar.length > 0 && !isConfirmed) {
      return void toast.error("Check the similar pieces below first.");
    }

    try {
      await addItem.mutateAsync({
        sku: sku.trim(),
        category,
        weightGrams,
        quantity,
        shopifyProductId: shopifyProductId.trim(),
        photo,
        pricing: draftToInventoryPricing(draft),
      });
      toast.success(`${sku.trim()} added to inventory`);
      // Category is kept so a run of same-category pieces doesn't need it re-picked each time.
      setSku("");
      setWeightGrams("");
      setQuantity("1");
      setShopifyProductId("");
      setPhoto(null);
      setConfirmedNew(false);
      // Making charge and override are kept: a run of similar pieces usually shares them.
      setPricingDraft((d) => ({ ...d, netWeight: "", stoneLineItems: [] }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save this item.");
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
        <CardTitle>Add stock</CardTitle>
        <div className="flex gap-2">
          <Button size="sm" variant={mode === "restock" ? "default" : "outline"} onClick={() => setMode("restock")}>
            <PackagePlus className="h-4 w-4" />
            Restock existing
          </Button>
          <Button size="sm" variant={mode === "new" ? "default" : "outline"} onClick={() => setMode("new")}>
            <Sparkles className="h-4 w-4" />
            Add new design
          </Button>
        </div>
      </CardHeader>

      <CardContent className="pt-0">
        {mode === "restock" ? (
          current ? (
            <form onSubmit={handleRestock} className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <ItemSummary item={current} />
                <Button type="button" variant="ghost" size="sm" onClick={() => setSelected(null)}>
                  Pick a different item
                </Button>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div>
                  <Label htmlFor="restockQuantity" className="mb-1.5 block text-sm font-normal">
                    How many arrived
                  </Label>
                  <Input
                    id="restockQuantity"
                    type="number"
                    inputMode="numeric"
                    min="1"
                    step="1"
                    value={restockQuantity}
                    onChange={(e) => setRestockQuantity(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="restockBy" className="mb-1.5 block text-sm font-normal">
                    Recorded by
                  </Label>
                  <Input id="restockBy" placeholder="Your name" value={recordedBy} onChange={(e) => setRecordedBy(e.target.value)} />
                </div>
                <div className="flex items-end">
                  <Button type="submit" className="w-full" disabled={restock.isPending}>
                    {restock.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                    Add to stock
                  </Button>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">Adds to this SKU&apos;s quantity on Inventory and on Shopify.</p>
            </form>
          ) : (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">
                Find the design that arrived — weigh a piece and type the weight to see the closest matches. Only add a new
                design if it really isn&apos;t here.
              </p>
              <ItemPicker items={items} onPick={(item) => chooseForRestock(item)} />
            </div>
          )
        ) : (
          <form onSubmit={handleAddNew} className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
              <div>
                <Label htmlFor="sku" className="mb-1.5 block text-sm font-normal">
                  SKU
                </Label>
                <Input id="sku" placeholder="e.g. R-1042" value={sku} onChange={(e) => setSku(e.target.value)} />
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
                  Gross weight (g)
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
                <Label className="mb-1.5 block text-sm font-normal">Photo (required)</Label>
                <InventoryPhotoPicker photo={photo} onSelect={setPhoto} onRemove={() => setPhoto(null)} />
              </div>
            </div>

            <div className="flex flex-col gap-3 rounded-xl border border-border p-4">
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium text-foreground">Pricing (required)</span>
                <span className="text-xs text-muted-foreground">
                  Products created from this SKU take this pricing, and stay in step with it.
                </span>
              </div>
              <PricingFields
                draft={draft}
                onChange={(patch) => setPricingDraft((d) => ({ ...d, ...patch }))}
                ratePerGram={ratePerGram}
                showGrossWeight={false}
              />
            </div>

            {similar.length > 0 ? (
              <div className="flex flex-col gap-3 rounded-xl border border-warning/40 bg-warning/5 p-4">
                <p className="flex items-start gap-2 text-sm text-foreground">
                  <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                  <span>
                    <span className="font-medium">Is it one of these?</span> {similar.length} piece
                    {similar.length === 1 ? "" : "s"} in this category weigh about the same. If it&apos;s the same design,
                    restock that SKU instead of adding a new one.
                  </span>
                </p>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                  {similar.slice(0, 12).map((item) => (
                    <div key={item.sku} className="flex flex-col overflow-hidden rounded-lg border border-border bg-card">
                      <div className="relative flex aspect-square items-center justify-center bg-muted">
                        {item.photoUrl ? (
                          <Image src={item.photoUrl} alt={item.sku} fill unoptimized className="object-cover" />
                        ) : (
                          <ImageOff className="h-4 w-4 text-muted-foreground" />
                        )}
                      </div>
                      <div className="flex flex-col gap-1.5 p-2">
                        <span className="truncate text-sm font-medium text-foreground">{item.sku}</span>
                        <span className="text-xs text-muted-foreground">
                          {formatGrams(item.weightGrams)} · {item.quantity} in stock
                        </span>
                        <Button type="button" size="sm" variant="outline" onClick={() => chooseForRestock(item, quantity)}>
                          This is it
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
                <label className="flex items-center gap-2 text-sm text-foreground">
                  <Checkbox
                    checked={isConfirmed}
                    onCheckedChange={(checked) => {
                      setConfirmedNew(checked === true);
                      setConfirmedFor(confirmationKey);
                    }}
                  />
                  None of these — it&apos;s a new design
                </label>
              </div>
            ) : null}

            <div>
              <Button type="submit" disabled={addItem.isPending || !pricingReady || (similar.length > 0 && !isConfirmed)}>
                {addItem.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                Add new design
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
