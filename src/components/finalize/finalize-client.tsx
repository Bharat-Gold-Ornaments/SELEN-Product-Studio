"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { toast } from "sonner";
import { ArrowLeft, CheckCircle2, ExternalLink, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { PageShell } from "@/components/layout/page-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  useProduct,
  usePublishProduct,
  useSyncProductListing,
  useSaveProductInventory,
  useRetryInventorySync,
} from "@/hooks/use-product";
import { useAppSettings } from "@/hooks/use-settings";
import { PricingPanel } from "@/components/pricing/pricing-panel";
import { VariantsPanel } from "@/components/finalize/variants-panel";
import { totalVariantInventory, type VariantRow } from "@/lib/variants";
import { IMAGE_CATEGORY_LABELS } from "@/lib/constants";

/**
 * Last stop before Shopify. Reads the product straight from Google Sheets
 * (via useProduct) rather than any in-memory session — by the time a
 * product can reach this screen, Review's Continue has already persisted
 * everything (copy + picked images) there, so this is safe to load
 * directly, refresh, or link to. Price and Inventory are the only editable
 * fields here since nothing upstream collects a price at all, and
 * inventory (set once at Create Product) may need one last adjustment
 * before the listing goes live.
 */
export function FinalizeClient({ productId }: { productId: string }) {
  const productQuery = useProduct(productId);
  const settingsQuery = useAppSettings();
  const publish = usePublishProduct();
  const syncListing = useSyncProductListing();
  const saveInventory = useSaveProductInventory();
  const retryInventorySync = useRetryInventorySync();

  const [price, setPrice] = useState("");
  const [inventory, setInventory] = useState("");
  const [variantRows, setVariantRows] = useState<VariantRow[]>([]);
  const [syncConfirmOpen, setSyncConfirmOpen] = useState(false);
  // Only seed the fields once, the first time the record loads — otherwise
  // a background refetch (React Query's default behavior) would stomp on
  // whatever the user is mid-typing.
  const initialized = useRef(false);

  useEffect(() => {
    if (!initialized.current && productQuery.data) {
      initialized.current = true;
      setPrice(productQuery.data.price > 0 ? String(productQuery.data.price) : "");
      setInventory(String(productQuery.data.inventory));
    }
  }, [productQuery.data]);

  if (productQuery.isLoading) {
    return (
      <PageShell title="Finalize">
        <div className="flex flex-1 items-center justify-center py-16">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      </PageShell>
    );
  }

  if (productQuery.error || !productQuery.data) {
    return (
      <PageShell title="Finalize">
        <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border py-16 text-center">
          <p className="text-sm text-foreground">
            {productQuery.error instanceof Error ? productQuery.error.message : "Couldn't load this product."}
          </p>
          <Button asChild variant="outline" size="sm">
            <Link href="/products">
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to Products
            </Link>
          </Button>
        </div>
      </PageShell>
    );
  }

  const record = productQuery.data;
  const images = [
    { label: IMAGE_CATEGORY_LABELS.hero, url: record.heroImageLink },
    { label: IMAGE_CATEGORY_LABELS.lifestyle, url: record.lifestyleImageLink },
    { label: IMAGE_CATEGORY_LABELS.closeup, url: record.closeupImageLink },
  ].filter((image) => image.url);

  const priceNumber = Number(price);
  const hasVariants = variantRows.length > 0;
  // Once variants exist, the flat Inventory field on this screen no longer
  // drives what gets published — the actual per-variant stock (saved
  // independently via the Variants panel) does. The total shown/sent here is
  // purely a reflection of that, so anything else in the app reading
  // record.inventory (Products list, dashboard) stays meaningful.
  const inventoryNumber = hasVariants ? totalVariantInventory(variantRows) : Number(inventory);
  const canPublish =
    price.trim() !== "" &&
    priceNumber > 0 &&
    (hasVariants || (inventory.trim() !== "" && Number.isInteger(inventoryNumber) && inventoryNumber >= 0));

  // Sheets-persisted status from a previous visit — shown until this page
  // publishes again itself, at which point publish.data (with a live
  // adminUrl to link to) takes over the success display instead.
  const alreadyPublished = record.status === "published" && !publish.data;

  async function handlePublish() {
    try {
      await publish.mutateAsync({ productId, price: priceNumber, inventory: inventoryNumber });
      toast.success("Sent to Shopify as a draft.", {
        description: "Hidden from your storefront until you review it and set it live in Shopify.",
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Publishing failed.");
    }
  }

  async function handleSyncListing() {
    try {
      await syncListing.mutateAsync(productId);
      toast.success("Shopify listing updated.");
      setSyncConfirmOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't update the Shopify listing.");
    }
  }

  async function handleSaveInventory() {
    try {
      const result = await saveInventory.mutateAsync({ productId, inventory: Number(inventory) });
      if (result.inventorySyncStatus === "out_of_sync") {
        toast.warning("Inventory saved, but syncing to Shopify failed — retry from below.");
      } else {
        toast.success("Inventory saved.");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't save inventory.");
    }
  }

  async function handleRetryInventorySync() {
    try {
      await retryInventorySync.mutateAsync(productId);
      toast.success("Inventory re-synced to Shopify.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't sync to Shopify.");
    }
  }

  return (
    <PageShell
      title="Finalize"
      description={`Product ${productId} — confirm price and inventory, then publish to Shopify.`}
      actions={
        <Button asChild variant="ghost" size="sm">
          <Link href={`/products/${productId}/review`}>
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to Review
          </Link>
        </Button>
      }
    >
      <Card>
        <CardHeader>
          <CardTitle>{record.title}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 pt-0">
          <div className="grid grid-cols-3 gap-3">
            {images.map((image) => (
              <div key={image.label} className="flex flex-col gap-1.5">
                <div className="relative aspect-square overflow-hidden rounded-xl border border-border bg-muted">
                  <Image src={image.url} alt={image.label} fill unoptimized className="object-cover" />
                </div>
                <span className="text-center text-xs text-muted-foreground">{image.label}</span>
              </div>
            ))}
          </div>
          <p className="text-sm text-muted-foreground">{record.description}</p>
          {record.tags.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {record.tags.map((tag) => (
                <Badge key={tag} variant="secondary">
                  {tag}
                </Badge>
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Inventory</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {hasVariants ? (
            <div className="max-w-xs space-y-1.5">
              <Label>Total Inventory (from variants)</Label>
              <p className="flex h-9 items-center rounded-md border border-dashed border-border px-3 text-sm text-muted-foreground">
                {inventoryNumber}
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="max-w-xs space-y-1.5">
                <Label>Inventory</Label>
                <Input type="number" min="0" step="1" value={inventory} onChange={(e) => setInventory(e.target.value)} />
              </div>

              {record.shopifyProductId ? (
                <>
                  <div className="flex items-center justify-between gap-3 rounded-xl border border-border px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      {record.inventorySyncStatus === "out_of_sync" ? (
                        <Badge variant="warning">Out of sync</Badge>
                      ) : record.inventorySyncStatus === "synced" ? (
                        <Badge variant="success">Synced to Shopify</Badge>
                      ) : (
                        <Badge variant="outline">Not yet synced</Badge>
                      )}
                      {record.inventorySyncedAt ? (
                        <span className="text-xs text-muted-foreground">
                          Last synced {new Date(record.inventorySyncedAt).toLocaleString()}
                        </span>
                      ) : null}
                    </div>
                    {record.inventorySyncStatus === "out_of_sync" ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleRetryInventorySync}
                        disabled={retryInventorySync.isPending}
                      >
                        {retryInventorySync.isPending ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <RefreshCw className="h-3.5 w-3.5" />
                        )}
                        Retry sync
                      </Button>
                    ) : null}
                  </div>

                  <Button
                    variant="outline"
                    size="sm"
                    className="self-start"
                    onClick={handleSaveInventory}
                    disabled={
                      inventory.trim() === "" ||
                      !Number.isInteger(Number(inventory)) ||
                      Number(inventory) < 0 ||
                      saveInventory.isPending
                    }
                  >
                    {saveInventory.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                    Save Inventory
                  </Button>
                </>
              ) : null}
            </div>
          )}
        </CardContent>
      </Card>

      <VariantsPanel
        productId={productId}
        record={record}
        basePrice={priceNumber}
        ratePerGram={settingsQuery.data?.ratePerGram ?? 0}
        onVariantsChanged={setVariantRows}
      />

      <PricingPanel
        productId={productId}
        record={record}
        ratePerGram={settingsQuery.data?.ratePerGram ?? 0}
        onPriced={(computed) => setPrice(String(computed))}
      />

      {publish.data ? (
        <div className="flex flex-col items-start gap-3 rounded-2xl border border-success/30 bg-success/5 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
          <span className="flex items-center gap-2 text-success">
            <CheckCircle2 className="h-4 w-4" />
            Sent to Shopify as a draft — set it live from Shopify when you&apos;re ready.
          </span>
          <Button asChild variant="outline" size="sm">
            <a href={publish.data.adminUrl} target="_blank" rel="noreferrer">
              <ExternalLink className="h-3.5 w-3.5" />
              View in Shopify
            </a>
          </Button>
        </div>
      ) : alreadyPublished ? (
        <div className="flex flex-col gap-3 rounded-2xl border border-success/30 bg-success/5 px-4 py-3 text-sm">
          <span className="flex items-center gap-2 text-success">
            <CheckCircle2 className="h-4 w-4" />
            Already sent to Shopify as a draft (Product ID: {record.shopifyProductId}).
          </span>
          <div className="flex flex-wrap items-center gap-2">
            {record.listingSyncStatus === "out_of_sync" ? (
              <Badge variant="warning">Listing out of sync</Badge>
            ) : record.listingSyncStatus === "synced" ? (
              <Badge variant="success">Listing synced</Badge>
            ) : null}
            {record.listingSyncedAt ? (
              <span className="text-xs text-muted-foreground">
                Last synced {new Date(record.listingSyncedAt).toLocaleString()}
              </span>
            ) : null}
            <Button variant="outline" size="sm" onClick={() => setSyncConfirmOpen(true)}>
              <RefreshCw className="h-3.5 w-3.5" />
              Update Shopify Listing
            </Button>
          </div>
        </div>
      ) : (
        <Button onClick={handlePublish} disabled={!canPublish || publish.isPending} className="self-start">
          {publish.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          Publish to Shopify
        </Button>
      )}

      <Dialog open={syncConfirmOpen} onOpenChange={(open) => !syncListing.isPending && setSyncConfirmOpen(open)}>
        <DialogContent className="w-full max-w-sm rounded-2xl border border-border bg-card p-5">
          <DialogTitle>Update the live Shopify listing?</DialogTitle>
          <p className="mt-1.5 text-sm text-muted-foreground">
            This will overwrite the title, description, tags, SEO, and photos on this product&apos;s live Shopify
            listing with what&apos;s currently saved here. This can&apos;t be undone.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={syncListing.isPending}
              onClick={() => setSyncConfirmOpen(false)}
            >
              Cancel
            </Button>
            <Button size="sm" disabled={syncListing.isPending} onClick={handleSyncListing}>
              {syncListing.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              Update Listing
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
