"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Link2, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  EMPTY_PRICING_DRAFT,
  PricingFields,
  pricingState,
  type PricingDraft,
} from "@/components/pricing/pricing-fields";
import { useSaveProductPricing, useRetryPriceSync } from "@/hooks/use-pricing";
import { GST_RATE, parseStoneLineItems } from "@/lib/pricing";
import type { ProductRecord } from "@/types/product";

interface PricingPanelProps {
  productId: string;
  record: ProductRecord;
  ratePerGram: number;
  onPriced: (price: number) => void;
}

/**
 * Finalize's pricing: the shared PricingFields plus save and Shopify sync
 * status. The computed price feeds Finalize's canPublish/handlePublish; it's
 * derived instead of hand-typed unless Manual Override is on. A product
 * created from an Inventory SKU shares that SKU's pricing, so saving here
 * also updates the Inventory row (services/pricing.ts).
 */
export function PricingPanel({ productId, record, ratePerGram, onPriced }: PricingPanelProps) {
  const [draft, setDraft] = useState<PricingDraft>(EMPTY_PRICING_DRAFT);
  const savePricing = useSaveProductPricing();
  const retrySync = useRetryPriceSync();

  // Seed once from the loaded record, same pattern as Finalize's own
  // price/inventory fields — a background refetch shouldn't stomp on
  // whatever the user is mid-editing.
  const initialized = useRef(false);
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    setDraft({
      grossWeight: record.weightGrams > 0 ? String(record.weightGrams) : "",
      netWeight: record.netWeightGrams > 0 ? String(record.netWeightGrams) : "",
      makingChargeMode: record.makingChargeMode,
      makingChargeValue: record.makingChargeValue > 0 ? String(record.makingChargeValue) : "",
      stoneLineItems: parseStoneLineItems(record.stoneLineItems),
      manualOverride: record.manualPriceOverride,
      // record.price is the final, GST-inclusive, charm-rounded price — the
      // override field is a pre-GST amount (see applyGstAndRound), so back
      // the GST out here. This is only an estimate: charm-rounding isn't
      // reversible, so it won't always reproduce the exact figure originally
      // typed, but it's close enough to re-edit from.
      overridePrice:
        record.manualPriceOverride && record.price > 0 ? String(Math.round(record.price / (1 + GST_RATE))) : "",
    });
  }, [record]);

  const { priceInputs, pricingCase, overridePriceNumber, canSave } = pricingState(draft, ratePerGram);

  async function handleSave() {
    try {
      const result = await savePricing.mutateAsync({
        productId,
        grossWeightGrams: priceInputs.grossWeightGrams,
        netWeightGrams: priceInputs.netWeightGrams,
        makingChargeMode: draft.makingChargeMode,
        makingChargeValue: priceInputs.makingChargeValue,
        stoneLineItems: draft.stoneLineItems,
        manualPriceOverride: draft.manualOverride,
        manualPriceOverrideValue: draft.manualOverride ? overridePriceNumber : undefined,
      });
      onPriced(result.price);
      if (result.priceSyncStatus === "out_of_sync") {
        toast.warning("Pricing saved, but syncing the price to Shopify failed — retry from below.");
      } else {
        toast.success(record.sku ? `Pricing saved, and updated on Inventory SKU ${record.sku}.` : "Pricing saved.");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't save pricing.");
    }
  }

  async function handleRetrySync() {
    try {
      const result = await retrySync.mutateAsync(productId);
      onPriced(result.price);
      toast.success("Price re-synced to Shopify.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't sync to Shopify.");
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle>Pricing</CardTitle>
        <Badge variant="outline">Case {pricingCase}</Badge>
      </CardHeader>
      <CardContent className="flex flex-col gap-5 pt-0">
        {record.sku ? (
          <p className="flex items-center gap-2 rounded-xl border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            <Link2 className="h-3.5 w-3.5 shrink-0" />
            Linked to Inventory SKU {record.sku} — saving here updates its pricing on the Inventory page too.
          </p>
        ) : null}

        <PricingFields draft={draft} onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))} ratePerGram={ratePerGram} />

        {record.shopifyProductId ? (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-border px-3 py-2.5">
            <div className="flex items-center gap-2">
              {record.priceSyncStatus === "out_of_sync" ? (
                <Badge variant="warning">Out of sync</Badge>
              ) : record.priceSyncStatus === "synced" ? (
                <Badge variant="success">Synced to Shopify</Badge>
              ) : (
                <Badge variant="outline">Not yet synced</Badge>
              )}
              {record.priceSyncedAt ? (
                <span className="text-xs text-muted-foreground">
                  Last synced {new Date(record.priceSyncedAt).toLocaleString()}
                </span>
              ) : null}
            </div>
            {record.priceSyncStatus === "out_of_sync" ? (
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

        <Button onClick={handleSave} disabled={!canSave || savePricing.isPending} className="self-start">
          {savePricing.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Save Pricing
        </Button>
      </CardContent>
    </Card>
  );
}
