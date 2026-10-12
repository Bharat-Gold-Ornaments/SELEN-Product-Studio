"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { toast } from "sonner";
import { Check, ImageOff, Loader2, Merge, TriangleAlert, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useRecordedBy } from "@/components/sales/use-recorded-by";
import { useDismissDuplicate, useDismissedDuplicates, useMergeInventoryItems } from "@/hooks/use-inventory";
import { possibleDuplicatePairs, type DuplicatePair } from "@/lib/inventory-duplicates";
import { INVENTORY_CATEGORIES } from "@/lib/constants";
import { cn, formatGrams } from "@/lib/utils";
import type { InventoryCategory, InventoryItem } from "@/types/inventory";

const CATEGORY_LABEL = Object.fromEntries(INVENTORY_CATEGORIES.map((c) => [c.value, c.label])) as Record<
  InventoryCategory,
  string
>;
const PAGE_SIZE = 10;

function Side({
  item,
  sold,
  keep,
  onKeep,
}: {
  item: InventoryItem;
  sold: number;
  keep: boolean;
  onKeep: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onKeep}
      className={cn(
        "flex flex-1 flex-col overflow-hidden rounded-xl border text-left transition-colors",
        keep ? "border-primary ring-1 ring-primary" : "border-border hover:border-primary/50"
      )}
    >
      <div className="relative flex aspect-square w-full items-center justify-center bg-muted">
        {item.photoUrl ? (
          <Image src={item.photoUrl} alt={item.sku} fill unoptimized className="object-cover" />
        ) : (
          <ImageOff className="h-5 w-5 text-muted-foreground" />
        )}
        {keep ? (
          <span className="absolute left-2 top-2 flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground">
            <Check className="h-3 w-3" />
            Keep
          </span>
        ) : null}
      </div>
      <div className="flex flex-col gap-0.5 p-3 text-xs text-muted-foreground">
        <span className="text-sm font-semibold text-foreground">{item.sku}</span>
        <span>
          {CATEGORY_LABEL[item.category] ?? item.category} · {formatGrams(item.weightGrams)}
        </span>
        <span>
          {item.quantity} in stock · {sold} sold
        </span>
        <span>{item.shopifyProductId ? `Shopify ${item.shopifyProductId}` : "No Shopify ID"}</span>
      </div>
    </button>
  );
}

function PairCard({
  pair,
  soldOf,
  recordedBy,
  onWarnings,
}: {
  pair: DuplicatePair;
  soldOf: (item: InventoryItem) => number;
  recordedBy: string;
  onWarnings: (warnings: string[]) => void;
}) {
  // Suggest keeping the row that's further along: on Shopify, has a photo, sold more.
  const score = (item: InventoryItem) =>
    (item.shopifyProductId ? 4 : 0) + (item.photoUrl ? 2 : 0) + (soldOf(item) > 0 ? 1 : 0);
  const [keepSku, setKeepSku] = useState(score(pair.b) > score(pair.a) ? pair.b.sku : pair.a.sku);
  const merge = useMergeInventoryItems();
  const dismiss = useDismissDuplicate();

  const keep = keepSku === pair.a.sku ? pair.a : pair.b;
  const remove = keep === pair.a ? pair.b : pair.a;

  async function handleMerge() {
    if (!recordedBy.trim()) {
      toast.error("Enter your name in “Recorded by” first.");
      return;
    }
    const message =
      `Merge ${remove.sku} into ${keep.sku}?\n\n` +
      `${keep.sku} will have ${keep.quantity + remove.quantity} in stock, and ${remove.sku} will be removed from Inventory. ` +
      `Products created from ${remove.sku} will point to ${keep.sku}.`;
    if (!window.confirm(message)) return;
    try {
      const result = await merge.mutateAsync({ keepSku: keep.sku, removeSku: remove.sku, recordedBy: recordedBy.trim() });
      toast.success(`Merged ${remove.sku} into ${keep.sku}.`);
      if (result.warnings.length) onWarnings(result.warnings);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't merge these items.");
    }
  }

  async function handleDismiss() {
    try {
      await dismiss.mutateAsync({ skuA: pair.a.sku, skuB: pair.b.sku });
      toast.success(`${pair.a.sku} and ${pair.b.sku} won't be suggested again.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't save that.");
    }
  }

  return (
    <Card className="flex flex-col gap-3 p-4">
      <p className="text-xs text-muted-foreground">
        Weights {pair.weightDifference === 0 ? "identical" : `differ by ${formatGrams(pair.weightDifference)}`}. Tap the
        one to keep.
      </p>
      <div className="flex gap-3">
        <Side item={pair.a} sold={soldOf(pair.a)} keep={keep === pair.a} onKeep={() => setKeepSku(pair.a.sku)} />
        <Side item={pair.b} sold={soldOf(pair.b)} keep={keep === pair.b} onKeep={() => setKeepSku(pair.b.sku)} />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={handleMerge} disabled={merge.isPending || dismiss.isPending}>
          {merge.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Merge className="h-3.5 w-3.5" />}
          Merge into {keep.sku}
        </Button>
        <Button size="sm" variant="outline" onClick={handleDismiss} disabled={merge.isPending || dismiss.isPending}>
          {dismiss.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
          Not a duplicate
        </Button>
      </div>
    </Card>
  );
}

/**
 * Pairs that may be one design entered under two SKUs — same category,
 * near-identical weight. Staff compare the photos, then merge or dismiss.
 */
export function DuplicatesPanel({ items, soldOf }: { items: InventoryItem[]; soldOf: (item: InventoryItem) => number }) {
  const dismissed = useDismissedDuplicates();
  const [recordedBy, setRecordedBy] = useRecordedBy();
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [warnings, setWarnings] = useState<string[]>([]);

  const pairs = useMemo(
    () => possibleDuplicatePairs(items, new Set(dismissed.data ?? [])),
    [items, dismissed.data]
  );

  if (dismissed.isLoading) {
    return (
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Skeleton className="h-[360px] rounded-2xl" />
        <Skeleton className="h-[360px] rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <p className="max-w-2xl text-sm text-muted-foreground">
          Pieces in the same category with almost the same weight — sometimes one design entered twice. Compare the photos:
          merge real duplicates into one SKU, or mark the pair &ldquo;Not a duplicate&rdquo; so it isn&apos;t suggested again.
        </p>
        <div className="sm:w-56">
          <Label htmlFor="mergeBy" className="mb-1.5 block text-sm font-normal">
            Recorded by
          </Label>
          <Input id="mergeBy" placeholder="Your name" value={recordedBy} onChange={(e) => setRecordedBy(e.target.value)} />
        </div>
      </div>

      {dismissed.isError ? (
        <p className="text-sm text-destructive">
          Couldn&apos;t load pairs already marked &ldquo;Not a duplicate&rdquo;, so they may show again.
        </p>
      ) : null}

      {warnings.length > 0 ? (
        <div className="flex flex-col gap-2 rounded-2xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-foreground">
          <span className="flex items-center gap-2 font-medium">
            <TriangleAlert className="h-4 w-4 text-warning" />
            Left to fix on Shopify
          </span>
          <ul className="list-disc pl-6">
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
          <Button variant="ghost" size="sm" className="self-start" onClick={() => setWarnings([])}>
            Dismiss
          </Button>
        </div>
      ) : null}

      {pairs.length === 0 ? (
        <div className="flex items-center justify-center rounded-2xl border border-dashed border-border py-16 text-sm text-muted-foreground">
          No possible duplicates.
        </div>
      ) : (
        <>
          <p className="text-sm font-medium text-foreground">
            {pairs.length} pair{pairs.length === 1 ? "" : "s"} to check
          </p>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {pairs.slice(0, limit).map((pair) => (
              <PairCard
                key={pair.key}
                pair={pair}
                soldOf={soldOf}
                recordedBy={recordedBy}
                onWarnings={(next) => setWarnings((current) => [...current, ...next])}
              />
            ))}
          </div>
          {pairs.length > limit ? (
            <Button variant="outline" className="self-center" onClick={() => setLimit((n) => n + PAGE_SIZE)}>
              Show more ({pairs.length - limit} left)
            </Button>
          ) : null}
        </>
      )}
    </div>
  );
}
