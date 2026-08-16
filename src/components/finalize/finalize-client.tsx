"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { toast } from "sonner";
import { ArrowLeft, CheckCircle2, ExternalLink, Loader2, Sparkles } from "lucide-react";
import { PageShell } from "@/components/layout/page-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useProduct, usePublishProduct } from "@/hooks/use-product";
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
  const publish = usePublishProduct();

  const [price, setPrice] = useState("");
  const [inventory, setInventory] = useState("");
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
  const inventoryNumber = Number(inventory);
  const canPublish =
    price.trim() !== "" &&
    priceNumber > 0 &&
    inventory.trim() !== "" &&
    Number.isInteger(inventoryNumber) &&
    inventoryNumber >= 0;

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
          <CardTitle>Price &amp; Inventory</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 pt-0 sm:flex-row">
          <div className="flex-1 space-y-1.5">
            <Label>Price (USD)</Label>
            <Input
              type="number"
              min="0"
              step="0.01"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="0.00"
            />
          </div>
          <div className="flex-1 space-y-1.5">
            <Label>Inventory</Label>
            <Input type="number" min="0" step="1" value={inventory} onChange={(e) => setInventory(e.target.value)} />
          </div>
        </CardContent>
      </Card>

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
        <div className="rounded-2xl border border-success/30 bg-success/5 px-4 py-3 text-sm text-success">
          Already sent to Shopify as a draft (Product ID: {record.shopifyProductId}).
        </div>
      ) : (
        <Button onClick={handlePublish} disabled={!canPublish || publish.isPending} className="self-start">
          {publish.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          Publish to Shopify
        </Button>
      )}
    </PageShell>
  );
}
