"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2, RefreshCw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { VariantsTable } from "@/components/finalize/variants-table";
import { VariantColorPhotosCard } from "@/components/finalize/variant-color-photos";
import {
  useSaveProductVariants,
  useRetryVariantsSync,
  useGenerateVariantColorImages,
  useUploadVariantColorImage,
  useRemoveVariantColorImage,
} from "@/hooks/use-variants";
import {
  parseVariantRows,
  validateVariantRows,
  totalVariantInventory,
  parseVariantColorImages,
  findVariantColorImageSet,
  type VariantRow,
  type VariantPricingContext,
} from "@/lib/variants";
import { parseStoneLineItems } from "@/lib/pricing";
import { IMAGE_CATEGORY_LABELS } from "@/lib/constants";
import type { ProductRecord } from "@/types/product";
import type { ImageCategory } from "@/types/product";

interface VariantsPanelProps {
  productId: string;
  record: ProductRecord;
  /** The product's current main price (Finalize's own price field) — used only to preview what a "same as main price" row would resolve to; the actual resolution always happens server-side against whatever price is current at save/publish time. */
  basePrice: number;
  /** Global rate/gram (Settings) — same value PricingPanel uses, threaded down so a custom-weight variant row's live preview runs the exact same formula. */
  ratePerGram: number;
  onVariantsChanged: (rows: VariantRow[]) => void;
}

/**
 * Color/Size variant editor for Finalize — mirrors PricingPanel's shape
 * (self-contained save button, sync status badge, retry on failure) but
 * saves independently of Publish, same reasoning as Pricing: work here
 * shouldn't be lost just because Publish hasn't run yet, and a post-publish
 * edit can reuse the exact same save path.
 */
export function VariantsPanel({ productId, record, basePrice, ratePerGram, onVariantsChanged }: VariantsPanelProps) {
  const [rows, setRows] = useState<VariantRow[]>([]);
  const [generatingColor, setGeneratingColor] = useState<string | null>(null);
  const [uploadingColor, setUploadingColor] = useState<string | null>(null);
  const [pendingReplace, setPendingReplace] = useState<
    | { type: "generate"; color: string }
    | { type: "upload"; color: string; file: File }
    | { type: "remove"; color: string; imageId: string }
    | null
  >(null);
  const saveVariants = useSaveProductVariants();
  const retrySync = useRetryVariantsSync();
  const generatePhotos = useGenerateVariantColorImages();
  const uploadPhoto = useUploadVariantColorImage();
  const removePhoto = useRemoveVariantColorImage();

  const initialized = useRef(false);
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    const parsed = parseVariantRows(record.variants);
    setRows(parsed);
    onVariantsChanged(parsed);
    // onVariantsChanged is stable from the parent (useState setter), so it's
    // deliberately left out of the dependency array — this effect should
    // only ever run once, seeding from the loaded record.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record]);

  const availableImages = (
    [
      ["hero", record.heroImageLink],
      ["lifestyle", record.lifestyleImageLink],
      ["closeup", record.closeupImageLink],
    ] as [ImageCategory, string][]
  )
    .filter(([, url]) => url)
    .map(([category, url]) => ({ category, url, label: IMAGE_CATEGORY_LABELS[category] }));

  const colorImageSets = parseVariantColorImages(record.variantColorImages);
  // One Generate-Photos card per distinct color actually used across rows,
  // excluding the product's own Default Finish color (which never needs
  // generation — it already has the product's base photos). Two Size rows
  // sharing one Color share this one card/action instead of duplicating it.
  const distinctNonDefaultColors = Array.from(
    new Set(
      rows
        .map((row) => row.color.trim())
        .filter((color) => color && color.toLowerCase() !== record.finish.trim().toLowerCase())
    )
  );

  const validationError = validateVariantRows(rows);
  const canSave = !validationError;

  const pricingContext: VariantPricingContext = {
    ratePerGram,
    makingChargeMode: record.makingChargeMode,
    makingChargeValue: record.makingChargeValue,
    stoneLineItems: parseStoneLineItems(record.stoneLineItems),
  };

  // Once this product has been published AND its variants successfully
  // synced at least once, whatever this color's photo currently is has
  // likely already been pushed to a live Shopify variant — regenerating or
  // replacing it here is a real, user-visible change to what's live, not
  // just local editing. Gated on the color actually being part of the last
  // *saved* variant set (record.variants), not the in-progress `rows` state,
  // since that's what was actually synced.
  function isColorLiveOnShopify(color: string): boolean {
    if (!record.shopifyProductId || record.variantsSyncStatus !== "synced") return false;
    const normalized = color.trim().toLowerCase();
    return parseVariantRows(record.variants).some((row) => row.color.trim().toLowerCase() === normalized);
  }

  async function runGeneratePhotos(color: string) {
    setGeneratingColor(color);
    try {
      const result = await generatePhotos.mutateAsync({ productId, color });
      if (result.status === "ready") {
        toast.success(`${color} photos generated.`);
      } else {
        toast.error(`Couldn't generate ${color} photos: ${result.error ?? "unknown error"}`);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't generate variant photos.");
    } finally {
      setGeneratingColor(null);
    }
  }

  async function runUploadPhoto(color: string, file: File) {
    setUploadingColor(color);
    try {
      await uploadPhoto.mutateAsync({ productId, color, file });
      toast.success(`${color} photo added.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't upload the image.");
    } finally {
      setUploadingColor(null);
    }
  }

  async function runRemovePhoto(color: string, imageId: string) {
    try {
      await removePhoto.mutateAsync({ productId, color, imageId });
      toast.success(`${color} photo removed.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't remove the image.");
    }
  }

  /**
   * A color already live on Shopify gets a confirm step before its gallery
   * is touched — regenerating/replacing/removing a photo will change what's
   * currently shown for that variant once Save Variants runs again. A color
   * with nothing live yet (never synced, or this is its first-ever photo)
   * just proceeds immediately — there's nothing to warn about overwriting.
   */
  function handleGeneratePhotos(color: string) {
    const hasExistingPhoto = (findVariantColorImageSet(colorImageSets, color)?.images.length ?? 0) > 0;
    if (hasExistingPhoto && isColorLiveOnShopify(color)) {
      setPendingReplace({ type: "generate", color });
    } else {
      runGeneratePhotos(color);
    }
  }

  function handleUploadPhoto(color: string, file: File) {
    const hasExistingPhoto = (findVariantColorImageSet(colorImageSets, color)?.images.length ?? 0) > 0;
    if (hasExistingPhoto && isColorLiveOnShopify(color)) {
      setPendingReplace({ type: "upload", color, file });
    } else {
      runUploadPhoto(color, file);
    }
  }

  function handleRemovePhoto(color: string, imageId: string) {
    if (isColorLiveOnShopify(color)) {
      setPendingReplace({ type: "remove", color, imageId });
    } else {
      runRemovePhoto(color, imageId);
    }
  }

  function confirmPendingReplace() {
    if (!pendingReplace) return;
    if (pendingReplace.type === "generate") {
      runGeneratePhotos(pendingReplace.color);
    } else if (pendingReplace.type === "upload") {
      runUploadPhoto(pendingReplace.color, pendingReplace.file);
    } else {
      runRemovePhoto(pendingReplace.color, pendingReplace.imageId);
    }
    setPendingReplace(null);
  }

  function handleRowsChange(next: VariantRow[]) {
    setRows(next);
    onVariantsChanged(next);
  }

  /**
   * The toggle's checked state is derived from `rows.length > 0` rather than
   * a separate stored flag — "empty variants array" already means "no
   * variants" everywhere else in this pipeline, so a second source of truth
   * would just be one more thing to keep in sync. Turning it on seeds one
   * "default variant" row using the product's own current color/inventory —
   * it needs no dedicated generated photos of its own, since it's just the
   * product's existing base listing. Turning it off clears the rows outright
   * (no confirm — nothing is persisted until Save Variants is clicked).
   */
  function handleToggleVariants(enabled: boolean) {
    if (enabled) {
      handleRowsChange([
        {
          id: crypto.randomUUID(),
          color: record.finish,
          size: "",
          sameAsMainPrice: true,
          grossWeightGrams: 0,
          netWeightGrams: 0,
          inventory: record.inventory,
          // This row IS the default color, so it should be the one variant
          // using the plain default photos.
          useDefaultImages: true,
        },
      ]);
    } else {
      handleRowsChange([]);
    }
  }

  async function handleSave() {
    try {
      const result = await saveVariants.mutateAsync({ productId, variants: rows });
      if (result.variantsSyncStatus === "out_of_sync") {
        toast.warning("Variants saved, but syncing to Shopify failed — retry from below.");
      } else {
        toast.success("Variants saved.");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't save variants.");
    }
  }

  async function handleRetrySync() {
    try {
      await retrySync.mutateAsync(productId);
      toast.success("Variants re-synced to Shopify.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't sync to Shopify.");
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <div className="flex items-center gap-3">
          <CardTitle>Variants</CardTitle>
          <Switch checked={rows.length > 0} onCheckedChange={handleToggleVariants} aria-label="Enable variants" />
        </div>
        {rows.length > 0 ? (
          <Badge variant="outline">{totalVariantInventory(rows)} in stock across {rows.length} variant{rows.length === 1 ? "" : "s"}</Badge>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-4 pt-0">
        {rows.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Off — this product publishes as a single listing. Turn on to sell it in more than one Color/Size.
          </p>
        ) : (
          <>
            {availableImages.length === 0 ? (
              <div className="flex items-center gap-2 rounded-xl border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-warning">
                <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
                No photos picked yet on Review — variants can still have a Color/Size/Stock/Price, just no dedicated
                photo until one is picked.
              </div>
            ) : null}

            {distinctNonDefaultColors.length > 0 ? (
              <div className="flex flex-col gap-2">
                {distinctNonDefaultColors.map((color) => (
                  <VariantColorPhotosCard
                    key={color}
                    color={color}
                    colorSet={findVariantColorImageSet(colorImageSets, color)}
                    isGenerating={generatingColor === color}
                    isUploading={uploadingColor === color}
                    onGenerate={() => handleGeneratePhotos(color)}
                    onUpload={(file) => handleUploadPhoto(color, file)}
                    onRemove={(imageId) => handleRemovePhoto(color, imageId)}
                  />
                ))}
              </div>
            ) : null}

            <VariantsTable
              rows={rows}
              onChange={handleRowsChange}
              defaultImages={availableImages}
              colorImageSets={colorImageSets}
              isRing={record.category === "ring"}
              mainPrice={basePrice}
              pricing={pricingContext}
            />

            {basePrice > 0 ? (
              <p className="text-xs text-muted-foreground">
                &quot;Same as main&quot; rows currently resolve to ₹{basePrice.toLocaleString("en-IN")}.
              </p>
            ) : null}
          </>
        )}

        {validationError ? (
          <p className="flex items-center gap-2 text-xs text-destructive">
            <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
            {validationError}
          </p>
        ) : null}

        {record.shopifyProductId && rows.length > 0 ? (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-border px-3 py-2.5">
            <div className="flex items-center gap-2">
              {record.variantsSyncStatus === "out_of_sync" ? (
                <Badge variant="warning">Out of sync</Badge>
              ) : record.variantsSyncStatus === "synced" ? (
                <Badge variant="success">Synced to Shopify</Badge>
              ) : (
                <Badge variant="outline">Not yet synced</Badge>
              )}
              {record.variantsSyncedAt ? (
                <span className="text-xs text-muted-foreground">
                  Last synced {new Date(record.variantsSyncedAt).toLocaleString()}
                </span>
              ) : null}
            </div>
            {record.variantsSyncStatus === "out_of_sync" ? (
              <Button variant="outline" size="sm" onClick={handleRetrySync} disabled={retrySync.isPending}>
                {retrySync.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
                Retry sync
              </Button>
            ) : null}
          </div>
        ) : null}

        <Button onClick={handleSave} disabled={!canSave || saveVariants.isPending} className="self-start">
          {saveVariants.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Save Variants
        </Button>
      </CardContent>

      <Dialog open={pendingReplace !== null} onOpenChange={(open) => !open && setPendingReplace(null)}>
        <DialogContent className="w-full max-w-sm rounded-2xl border border-border bg-card p-5">
          <DialogTitle>
            {pendingReplace?.type === "remove" ? "Remove the live Shopify photo?" : "Change the live Shopify gallery?"}
          </DialogTitle>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {pendingReplace?.color}&apos;s gallery is already synced to Shopify.{" "}
            {pendingReplace?.type === "generate"
              ? "Regenerating it"
              : pendingReplace?.type === "upload"
                ? "Adding a new photo"
                : "Removing this photo"}{" "}
            will change what customers currently see for that variant once you Save Variants again. This can&apos;t
            be undone.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setPendingReplace(null)}>
              Cancel
            </Button>
            <Button size="sm" onClick={confirmPendingReplace} variant={pendingReplace?.type === "remove" ? "destructive" : "default"}>
              {pendingReplace?.type === "generate" ? "Regenerate" : pendingReplace?.type === "upload" ? "Add" : "Remove"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
