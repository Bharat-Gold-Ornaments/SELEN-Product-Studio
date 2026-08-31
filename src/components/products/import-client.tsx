"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowLeft, Loader2, PackageSearch, RefreshCw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PRODUCT_TYPES } from "@/lib/constants";
import { useImportCandidates, useImportProducts } from "@/hooks/use-shopify-import";
import { useAppSettings } from "@/hooks/use-settings";
import type { ProductType } from "@/types/product";

const DEFAULT_CATEGORY: ProductType = PRODUCT_TYPES[0].value;

/**
 * Review screen for "Import from Shopify" — one row per Shopify product not
 * yet tracked in the Sheet (see api/products/import-candidates/route.ts).
 * A checkbox in front of each row controls whether it's included — checked
 * by default only where a category guess was actually found, so a row with
 * no guess needs an explicit look before it's part of the batch. Every row
 * also gets a Gross Weight guess from this app's own custom metafield if
 * the product happens to already have one (almost never, for something
 * created by hand in Shopify) — weight is always an editable, required
 * input, never silently assumed. Making Charge (₹/g) is asked once, in a
 * confirm popup, for the whole batch being imported, then every checked
 * row's price is computed through the same formula (src/lib/pricing.ts)
 * the Pricing panel uses — never taken from Shopify's live price.
 */
export function ImportClient() {
  const candidatesQuery = useImportCandidates();
  const settingsQuery = useAppSettings();
  const importProducts = useImportProducts();

  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [categories, setCategories] = useState<Record<string, ProductType>>({});
  const [weights, setWeights] = useState<Record<string, string>>({});
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [makingCharge, setMakingCharge] = useState("");
  // Only seed once, the same pattern as PricingPanel/Finalize — a background
  // refetch (e.g. after a successful import removes rows from the list)
  // shouldn't stomp on selections/weights already made for whatever's left.
  const initialized = useRef(false);

  useEffect(() => {
    if (!initialized.current && candidatesQuery.data) {
      initialized.current = true;
      const seededChecked: Record<string, boolean> = {};
      const seededCategories: Record<string, ProductType> = {};
      const seededWeights: Record<string, string> = {};
      for (const candidate of candidatesQuery.data) {
        seededChecked[candidate.shopifyProductId] = candidate.guessedCategory != null;
        seededCategories[candidate.shopifyProductId] = candidate.guessedCategory ?? DEFAULT_CATEGORY;
        seededWeights[candidate.shopifyProductId] = candidate.weightGrams != null ? String(candidate.weightGrams) : "";
      }
      setChecked(seededChecked);
      setCategories(seededCategories);
      setWeights(seededWeights);
    }
  }, [candidatesQuery.data]);

  const candidates = candidatesQuery.data ?? [];
  const ratePerGram = settingsQuery.data?.ratePerGram ?? 0;

  const selected = candidates.filter((c) => checked[c.shopifyProductId]);
  const missingWeightCount = selected.filter((c) => !(Number(weights[c.shopifyProductId]) > 0)).length;
  const makingChargeNumber = Number(makingCharge);
  const canConfirmImport = makingCharge.trim() !== "" && makingChargeNumber >= 0;

  async function handleConfirmImport() {
    const selections = selected.map((candidate) => ({
      candidate,
      category: categories[candidate.shopifyProductId] ?? DEFAULT_CATEGORY,
      grossWeightGrams: Number(weights[candidate.shopifyProductId]),
      makingChargeValue: makingChargeNumber,
    }));

    try {
      const result = await importProducts.mutateAsync(selections);
      if (result.failed.length === 0) {
        toast.success(`Imported ${result.imported} product${result.imported === 1 ? "" : "s"}.`);
      } else {
        toast.warning(
          `Imported ${result.imported} of ${selections.length} — ${result.failed.length} failed: ${result.failed
            .map((f) => f.message)
            .join("; ")}`
        );
      }
      setConfirmOpen(false);
      setMakingCharge("");
      // Clear seeded state so a retry after a partial failure re-seeds from
      // whatever's left rather than re-submitting already-imported rows.
      initialized.current = false;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Import failed.");
    }
  }

  if (candidatesQuery.isLoading) {
    return (
      <div className="flex flex-col gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full rounded-2xl" />
        ))}
      </div>
    );
  }

  if (candidatesQuery.error) {
    return (
      <div className="flex flex-col items-start justify-between gap-3 rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm sm:flex-row sm:items-center">
        <span className="flex items-center gap-2 text-destructive">
          <TriangleAlert className="h-4 w-4 shrink-0" />
          {candidatesQuery.error instanceof Error ? candidatesQuery.error.message : "Couldn't load Shopify products."}
        </span>
        <Button variant="outline" size="sm" onClick={() => candidatesQuery.refetch()}>
          <RefreshCw className="h-3.5 w-3.5" />
          Retry
        </Button>
      </div>
    );
  }

  if (candidates.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border py-16 text-center">
        <PackageSearch className="h-5 w-5 text-muted-foreground" />
        <p className="text-sm text-foreground">Every Shopify product is already tracked here.</p>
        <Button asChild variant="outline" size="sm">
          <Link href="/products">
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to Products
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
      {ratePerGram <= 0 ? (
        <div className="flex items-center gap-2 rounded-xl border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-warning">
          <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
          No Rate/gram set yet — set it on Settings before importing, since price is computed from it.
        </div>
      ) : null}

      <Card className="flex-1 divide-y divide-border overflow-hidden p-0">
        {candidates.map((candidate) => {
          const imageUrl = candidate.imageUrls[0];
          const isSelected = checked[candidate.shopifyProductId] ?? false;
          const category = categories[candidate.shopifyProductId] ?? DEFAULT_CATEGORY;
          const weight = weights[candidate.shopifyProductId] ?? "";
          return (
            <div key={candidate.shopifyProductId} className="flex items-center gap-3 px-4 py-3">
              <Checkbox
                checked={isSelected}
                onCheckedChange={(v) =>
                  setChecked((prev) => ({ ...prev, [candidate.shopifyProductId]: v === true }))
                }
                aria-label={`Include ${candidate.title}`}
              />
              <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-xl bg-muted">
                {imageUrl ? <Image src={imageUrl} alt="" fill unoptimized className="object-cover" /> : null}
              </div>
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-medium text-foreground">{candidate.title}</span>
                <span className="text-xs text-muted-foreground">
                  {candidate.productType || "No Shopify type"} · Shopify price ₹{candidate.price.toLocaleString("en-IN")} ·{" "}
                  {candidate.inventory} in stock
                </span>
              </div>
              <div className="w-28 shrink-0">
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="Weight (g)"
                  value={weight}
                  disabled={!isSelected}
                  onChange={(e) => setWeights((prev) => ({ ...prev, [candidate.shopifyProductId]: e.target.value }))}
                  className={isSelected && !(Number(weight) > 0) ? "border-destructive" : undefined}
                />
              </div>
              <Select
                value={category}
                disabled={!isSelected}
                onValueChange={(v) =>
                  setCategories((prev) => ({ ...prev, [candidate.shopifyProductId]: v as ProductType }))
                }
              >
                <SelectTrigger className="w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRODUCT_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          );
        })}
      </Card>

      <Button
        onClick={() => setConfirmOpen(true)}
        disabled={selected.length === 0 || missingWeightCount > 0 || ratePerGram <= 0}
        className="self-start"
      >
        Import Selected ({selected.length})
      </Button>
      {selected.length > 0 && missingWeightCount > 0 ? (
        <p className="text-xs text-destructive">
          Enter a Gross Weight for every selected product ({missingWeightCount} missing) before importing.
        </p>
      ) : null}

      <Dialog open={confirmOpen} onOpenChange={(open) => !importProducts.isPending && setConfirmOpen(open)}>
        <DialogContent className="w-full max-w-sm rounded-2xl border border-border bg-card p-5">
          <DialogTitle>Making Charge for this batch</DialogTitle>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Applied per gram to all {selected.length} selected product{selected.length === 1 ? "" : "s"}, together with
            the current Rate/gram (₹{ratePerGram.toLocaleString("en-IN")}), to compute each one&apos;s price.
          </p>
          <div className="mt-3 space-y-1.5">
            <Label>Making Charge (₹/g)</Label>
            <Input
              type="number"
              min="0"
              step="0.01"
              autoFocus
              value={makingCharge}
              onChange={(e) => setMakingCharge(e.target.value)}
            />
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="outline" size="sm" disabled={importProducts.isPending} onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" disabled={!canConfirmImport || importProducts.isPending} onClick={handleConfirmImport}>
              {importProducts.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              Import
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
