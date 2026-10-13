"use client";

import { useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Link2, Loader2 } from "lucide-react";
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
import { useProductsList } from "@/hooks/use-products-list";
import { useAppSettings } from "@/hooks/use-settings";
import {
  EMPTY_PRICING_DRAFT,
  PricingFields,
  draftFromInventoryPricing,
  draftToInventoryPricing,
  pricingState,
  type PricingDraft,
} from "@/components/pricing/pricing-fields";
import { hasPricing, pricingFromProduct, pricingOf } from "@/lib/inventory-pricing";
import { normalizeSku } from "@/lib/sku";
import { describeSkuUse, skuUses } from "@/lib/product-skus";
import { parseVariantRows } from "@/lib/variants";
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
  const ratePerGram = useAppSettings().data?.ratePerGram ?? 0;
  const products = useProductsList();
  // The products, or product variants, that sell this SKU.
  const linkedProducts = useMemo(() => {
    const records = products.data ?? [];
    return (skuUses(records).get(normalizeSku(item.sku)) ?? []).map((use) => {
      const record = records.find((p) => p.productId === use.productId)!;
      const row = use.variantId ? parseVariantRows(record.variants).find((r) => r.id === use.variantId) : undefined;
      return { title: describeSkuUse(use), record, row };
    });
  }, [products.data, item.sku]);

  // Starting pricing: the item's own, or — for an item never priced — that of
  // the product (or variant) already selling it, so pricing entered on
  // Finalize before Inventory had pricing isn't lost.
  const productPricing = useMemo(() => {
    for (const linked of linkedProducts) {
      const pricing = pricingFromProduct(linked.record, linked.row);
      if (pricing) return { title: linked.title, pricing };
    }
    return null;
  }, [linkedProducts]);
  const initialPricing = hasPricing(item) ? pricingOf(item) : (productPricing?.pricing ?? null);
  const initialDraft = initialPricing
    ? draftFromInventoryPricing(item.weightGrams, initialPricing)
    : { ...EMPTY_PRICING_DRAFT, grossWeight: String(item.weightGrams) };
  const [pricingDraft, setPricingDraft] = useState<PricingDraft | null>(null);
  // Products load after the dialog opens; until the pricing is edited, follow what's loaded.
  const draft = { ...(pricingDraft ?? initialDraft), grossWeight: weightGrams };
  const pricing = pricingState(draft, ratePerGram);
  const pricingEntered = draft.netWeight.trim() !== "";
  const pricingDirty =
    pricingEntered &&
    (!hasPricing(item) || JSON.stringify(draftToInventoryPricing(draft)) !== JSON.stringify(pricingOf(item)));

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
    if (hasPricing(item) && !pricingEntered) {
      toast.error("Pricing can't be removed — enter the net weight.");
      return;
    }
    if (pricingEntered && (pricing.validationError || (draft.manualOverride && !(pricing.overridePriceNumber > 0)))) {
      toast.error(pricing.validationError ?? "Enter the manual override price.");
      return;
    }

    try {
      const result = await update.mutateAsync({
        sku: item.sku,
        newSku: trimmedSku !== item.sku ? trimmedSku : undefined,
        category,
        weightGrams: Number(weightGrams),
        quantity: Number(quantity),
        shopifyProductId: shopifyProductId.trim(),
        photo: photo ?? undefined,
        removePhoto: photoRemoved,
        pricing: pricingDirty ? draftToInventoryPricing(draft) : undefined,
      });
      const failed = result.linkedProducts.filter((p) => p.error || p.priceSyncStatus === "out_of_sync");
      const updated = result.linkedProducts.length - failed.length;
      if (failed.length > 0) {
        toast.warning(
          `${trimmedSku} updated, but the price of ${failed.map((p) => p.title).join(", ")} couldn't be fully updated: ` +
            (failed[0].error ?? "Shopify sync failed — retry from its Finalize page.")
        );
      } else if (updated > 0) {
        toast.success(`${trimmedSku} updated — new price applied to ${updated} product${updated === 1 ? "" : "s"} and Shopify.`);
      } else {
        toast.success(`${trimmedSku} updated`);
      }
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't update this item.");
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto rounded-2xl border border-border bg-card p-6 shadow-xl">
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
              Gross weight (g)
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
          <div className="col-span-2 flex flex-col gap-3 rounded-xl border border-border p-4">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium text-foreground">Pricing</span>
              {linkedProducts.length > 0 ? (
                <span className="flex items-start gap-1.5 text-xs text-muted-foreground">
                  <Link2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  Shared with {linkedProducts.map((p) => p.title).join(", ")} — a change here updates
                  {linkedProducts.length === 1 ? " its" : " their"} price on the Products tab and Shopify.
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">Products created from this SKU take this pricing.</span>
              )}
              {!hasPricing(item) && productPricing ? (
                <span className="text-xs text-warning">
                  Filled in from {productPricing.title}. Save to keep it on Inventory too.
                </span>
              ) : null}
            </div>
            <PricingFields
              draft={draft}
              onChange={(patch) => setPricingDraft({ ...draft, ...patch })}
              ratePerGram={ratePerGram}
              showGrossWeight={false}
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
