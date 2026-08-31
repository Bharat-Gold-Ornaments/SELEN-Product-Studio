"use client";

import { useState } from "react";
import { ImagePlus, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { FINISH_OPTIONS } from "@/lib/product-schemas";
import {
  findVariantColorImageSet,
  RING_SIZE_OPTIONS,
  type VariantRow,
  type VariantColorImageSet,
  type VariantPricingContext,
} from "@/lib/variants";
import { computeFinalPrice } from "@/lib/pricing";
import type { ImageCategory } from "@/types/product";

interface VariantsTableProps {
  rows: VariantRow[];
  onChange: (rows: VariantRow[]) => void;
  /** The product's own picked Hero/Lifestyle/Closeup photos (from Review) — shown as a preview once a row picks "Use default images". */
  defaultImages: { category: ImageCategory; url: string; label: string }[];
  /** Every color's AI-generated/manually-uploaded gallery (see VariantColorPhotosCard, rendered above this table) — shown as a preview once a row picks "Use generated/uploaded images", and checked before allowing that pick at all. */
  colorImageSets: VariantColorImageSet[];
  /** Only rings get a Size option — every other product type (earrings, pendant, necklace, bracelet) is color-only, so the Size field is hidden entirely rather than left as free text nobody should fill in. */
  isRing: boolean;
  /** The product's own main computed price — what a "Same as main" row resolves to. */
  mainPrice: number;
  /** Rate/gram plus the product's own making-charge/stone data — everything a custom-weight row's live preview needs to run the exact same formula as the main Pricing panel. */
  pricing: VariantPricingContext;
}

/** New rows default to "not using default images" — they're only ever added for an additional color, which should get its own dedicated photo rather than silently falling back to the default listing's. They also default to "same as main price" — opting into a custom weight is a deliberate per-row choice, not the default. */
function newVariantRow(): VariantRow {
  return {
    id: crypto.randomUUID(),
    color: "",
    size: "",
    sameAsMainPrice: true,
    grossWeightGrams: 0,
    netWeightGrams: 0,
    inventory: 0,
    useDefaultImages: false,
  };
}

/**
 * Repeatable Color/Size variant editor — mirrors StoneLineItemsTable's
 * add/remove row shape (src/components/pricing/stone-line-items-table.tsx).
 * Each row is one Color/Size combination with its own stock, an optional
 * custom price (otherwise "same as main price"), and two mutually-exclusive
 * checkboxes for which photos it shows: "Use default images" or "Use
 * generated/uploaded images" — both bound to the one `useDefaultImages`
 * boolean, so exactly one is ever checked. "Use default images" is exclusive
 * *across Colors* (at most one Color at a time claims it — see
 * services/shopify.ts's `defaultImagesColor` logic, which only knows how to
 * tag the base images for one color), but every Size row of that same Color
 * is free to share it, since they're genuinely the same photo. Color is a
 * strict
 * picker from FINISH_OPTIONS, not free text — same 3 values as Default
 * Finish (product-schemas.ts) and the only 3 the storefront's own
 * swatch/gallery matching (selen-sparkle-shop's colorOption.ts) reliably
 * recognizes; a mistyped or off-list color would silently lose its curated
 * Shopify gallery (see colorGalleryMetafieldKey in lib/variants.ts). Size,
 * when shown at all (rings only), is likewise a strict picker from
 * RING_SIZE_OPTIONS — the exact fixed set the storefront's own size
 * selector renders as buttons; any other size would be created on Shopify
 * but have no way to be selected on the storefront.
 */
export function VariantsTable({
  rows,
  onChange,
  defaultImages,
  colorImageSets,
  isRing,
  mainPrice,
  pricing,
}: VariantsTableProps) {
  const [blockedRowId, setBlockedRowId] = useState<string | null>(null);
  const [bulkAddOpen, setBulkAddOpen] = useState(false);
  const [bulkColor, setBulkColor] = useState("");
  const [bulkSizes, setBulkSizes] = useState<string[]>([]);

  function updateRow(id: string, patch: Partial<VariantRow>) {
    onChange(rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }

  function removeRow(id: string) {
    onChange(rows.filter((row) => row.id !== id));
  }

  function addRow() {
    if (isRing) {
      setBulkAddOpen(true);
      return;
    }
    onChange([...rows, newVariantRow()]);
  }

  function toggleBulkSize(size: string) {
    setBulkSizes((prev) => (prev.includes(size) ? prev.filter((s) => s !== size) : [...prev, size]));
  }

  /**
   * Rings need many Size variants per Color, and adding them one row at a
   * time (pick color, pick size, repeat) is tedious — this lets one Color +
   * several Sizes become several rows in one shot, each still independently
   * editable afterward. Skips any (color, size) combination that's already
   * a row, rather than creating a duplicate that validateVariantRows would
   * just reject as a save-blocking error anyway.
   */
  function confirmBulkAdd() {
    const existing = new Set(rows.map((row) => `${row.color.trim().toLowerCase()}::${row.size.trim().toLowerCase()}`));
    const newRows = bulkSizes
      .filter((size) => !existing.has(`${bulkColor.trim().toLowerCase()}::${size.trim().toLowerCase()}`))
      .map((size) => ({ ...newVariantRow(), color: bulkColor, size }));
    onChange([...rows, ...newRows]);
    setBulkAddOpen(false);
    setBulkColor("");
    setBulkSizes([]);
  }

  function cancelBulkAdd() {
    setBulkAddOpen(false);
    setBulkColor("");
    setBulkSizes([]);
  }

  // `useDefaultImages: true` is how a row says "don't attach a dedicated
  // gallery — show the product's plain default images instead" (see
  // services/shopify.ts's buildVariantsInput/attachVariantGalleries). Every
  // Size of the *same* Color is free to share this — they're all genuinely
  // the same photo. Exclusive only *across different Colors*: Shopify's
  // create/sync code (createShopifyProduct/syncShopifyProductVariants) tags
  // the base images with whichever single color the first `useDefaultImages`
  // row happens to have, so a second color claiming it too would silently
  // get no photo/gallery of its own.
  const defaultImagesColor = rows.find((row) => row.useDefaultImages)?.color.trim().toLowerCase() ?? null;

  function selectGeneratedImages(row: VariantRow) {
    const images = findVariantColorImageSet(colorImageSets, row.color)?.images ?? [];
    if (images.length === 0) {
      setBlockedRowId(row.id);
      return;
    }
    updateRow(row.id, { useDefaultImages: false });
  }

  return (
    <div className="flex flex-col gap-3">
      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
          No variants yet — this product will publish as a single listing. Add a row for each Color/Size combination
          you sell.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {rows.map((row) => {
            const usesDefaultImages = row.useDefaultImages;
            const defaultCheckboxDisabled =
              !usesDefaultImages &&
              defaultImagesColor !== null &&
              defaultImagesColor !== row.color.trim().toLowerCase();
            const ownImages = findVariantColorImageSet(colorImageSets, row.color)?.images ?? [];

            return (
              <div
                key={row.id}
                className="relative grid grid-cols-1 gap-3 rounded-xl border border-border p-3 pr-10 sm:grid-cols-12 sm:items-start"
              >
                <button
                  type="button"
                  onClick={() => removeRow(row.id)}
                  aria-label="Remove variant"
                  className="absolute right-2 top-2 rounded-md p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-destructive"
                >
                  <X className="h-4 w-4" />
                </button>

                <div className={isRing ? "sm:col-span-3" : "sm:col-span-5"}>
                  <Label className="text-xs text-muted-foreground">Color</Label>
                  <Select
                    value={row.color}
                    onValueChange={(color) =>
                      // Changing color always drops "use default images" —
                      // otherwise a row could carry that flag over to a new
                      // color and silently collide with whichever other
                      // color already holds it (see defaultImagesColor
                      // above). Forces a fresh, gated re-check instead.
                      updateRow(row.id, { color, useDefaultImages: false })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select a color" />
                    </SelectTrigger>
                    <SelectContent>
                      {FINISH_OPTIONS.map((option) => (
                        <SelectItem key={option} value={option}>
                          {option}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {isRing ? (
                  <div className="sm:col-span-2">
                    <Label className="text-xs text-muted-foreground">Size</Label>
                    <Select value={row.size} onValueChange={(size) => updateRow(row.id, { size })}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a size" />
                      </SelectTrigger>
                      <SelectContent>
                        {RING_SIZE_OPTIONS.map((option) => (
                          <SelectItem key={option} value={option}>
                            {option}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : null}

                <div className="sm:col-span-3">
                  <Label className="text-xs text-muted-foreground">Price</Label>
                  <div className="flex h-9 items-center gap-2">
                    <Switch
                      checked={row.sameAsMainPrice}
                      onCheckedChange={(checked) => updateRow(row.id, { sameAsMainPrice: checked })}
                    />
                    <span className="text-xs text-muted-foreground">Same as main</span>
                  </div>
                  {!row.sameAsMainPrice ? (
                    <div className="mt-1.5 flex flex-col gap-1">
                      {/* Gross weight is also what's written to Shopify as
                          the `custom.variant_weight` metafield the
                          storefront shows (see services/shopify.ts) — so a
                          row only carries/displays a weight while it's also
                          using a custom weight-based price. */}
                      <div className="grid grid-cols-2 gap-1.5">
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          placeholder="Gross weight"
                          value={row.grossWeightGrams || ""}
                          onChange={(e) => updateRow(row.id, { grossWeightGrams: Number(e.target.value) || 0 })}
                        />
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          placeholder="Net weight"
                          value={row.netWeightGrams || ""}
                          onChange={(e) => updateRow(row.id, { netWeightGrams: Number(e.target.value) || 0 })}
                        />
                      </div>
                      {row.grossWeightGrams > 0 && row.netWeightGrams > 0 ? (
                        <span className="text-[0.65rem] text-muted-foreground">
                          ₹
                          {computeFinalPrice({
                            grossWeightGrams: row.grossWeightGrams,
                            netWeightGrams: row.netWeightGrams,
                            ratePerGram: pricing.ratePerGram,
                            makingChargeMode: pricing.makingChargeMode,
                            makingChargeValue: pricing.makingChargeValue,
                            stoneLineItems: pricing.stoneLineItems,
                          }).toLocaleString("en-IN")}
                        </span>
                      ) : null}
                    </div>
                  ) : (
                    <p className="mt-1.5 text-[0.65rem] text-muted-foreground">₹{mainPrice.toLocaleString("en-IN")}</p>
                  )}
                </div>

                <div className="sm:col-span-2">
                  <Label className="text-xs text-muted-foreground">Stock</Label>
                  <Input
                    type="number"
                    min="0"
                    step="1"
                    value={row.inventory || ""}
                    onChange={(e) => updateRow(row.id, { inventory: Number(e.target.value) || 0 })}
                  />
                </div>

                <div className="flex flex-col gap-1.5 sm:col-span-2">
                  <Label className="text-xs text-muted-foreground">Photo</Label>
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Checkbox
                      checked={usesDefaultImages}
                      disabled={defaultCheckboxDisabled}
                      onCheckedChange={(checked) => checked && updateRow(row.id, { useDefaultImages: true })}
                    />
                    Use default images
                  </label>
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Checkbox
                      checked={!usesDefaultImages}
                      onCheckedChange={(checked) => checked && selectGeneratedImages(row)}
                    />
                    Use generated/uploaded images
                  </label>
                  {defaultCheckboxDisabled ? (
                    <p className="text-[0.65rem] text-muted-foreground">
                      Another color already uses the default images.
                    </p>
                  ) : null}
                </div>

                {usesDefaultImages && defaultImages.length > 0 ? (
                  <div className="flex flex-wrap gap-2 sm:col-span-12">
                    {defaultImages.map((image) => (
                      <div key={image.category} className="flex flex-col items-center gap-1">
                        {/* Drive image-proxy URL — plain <img> rather than
                            next/image, same reasoning as the thumbnails in
                            variant-color-photos.tsx. */}
                        <img
                          src={image.url}
                          alt={image.label}
                          className="h-14 w-14 rounded-lg border border-border object-cover"
                        />
                        <span className="text-[0.6rem] uppercase tracking-wide text-muted-foreground">
                          {image.label.replace(" Images", "")}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : null}

                {!usesDefaultImages ? (
                  <div className="flex flex-wrap items-center gap-2 sm:col-span-12">
                    {ownImages.length > 0 ? (
                      ownImages.map((image) => (
                        <img
                          key={image.id}
                          src={image.url}
                          alt={`${row.color} preview`}
                          className="h-14 w-14 rounded-lg border border-border object-cover"
                        />
                      ))
                    ) : (
                      <p className="flex items-center gap-1.5 text-[0.7rem] text-muted-foreground">
                        <ImagePlus className="h-3.5 w-3.5 shrink-0" />
                        No photos yet for {row.color || "this color"} — generate or add one above.
                      </p>
                    )}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
      {bulkAddOpen ? (
        <div className="flex flex-col gap-3 rounded-xl border border-border p-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label className="text-xs text-muted-foreground">Color</Label>
              <Select value={bulkColor} onValueChange={setBulkColor}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a color" />
                </SelectTrigger>
                <SelectContent>
                  {FINISH_OPTIONS.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Sizes</Label>
              <div className="flex flex-wrap gap-1.5">
                {RING_SIZE_OPTIONS.map((size) => (
                  <button
                    key={size}
                    type="button"
                    onClick={() => toggleBulkSize(size)}
                    className={cn(
                      "h-9 min-w-[2.75rem] rounded-md border px-3 text-sm transition-colors",
                      bulkSizes.includes(size)
                        ? "border-primary bg-accent text-accent-foreground"
                        : "border-input text-foreground hover:border-primary"
                    )}
                  >
                    {size}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={cancelBulkAdd}>
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={confirmBulkAdd}
              disabled={!bulkColor || bulkSizes.length === 0}
            >
              Add {bulkSizes.length > 0 ? bulkSizes.length : ""} Variant{bulkSizes.length === 1 ? "" : "s"}
            </Button>
          </div>
        </div>
      ) : (
        <Button type="button" variant="outline" size="sm" className="self-start" onClick={addRow}>
          <Plus className="h-3.5 w-3.5" />
          {isRing ? "Add Sizes" : "Add Variant"}
        </Button>
      )}

      <Dialog open={blockedRowId !== null} onOpenChange={(open) => !open && setBlockedRowId(null)}>
        <DialogContent className="w-full max-w-sm rounded-2xl border border-border bg-card p-5">
          <DialogTitle>Not generated yet</DialogTitle>
          <p className="mt-1.5 text-sm text-muted-foreground">
            This color has no generated or uploaded photos yet. Generate its photos (or add one by hand) above before
            switching this variant to use them.
          </p>
          <div className="mt-4 flex justify-end">
            <Button size="sm" onClick={() => setBlockedRowId(null)}>
              Got it
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
