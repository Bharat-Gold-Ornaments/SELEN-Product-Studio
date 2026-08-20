"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2, RefreshCw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { StoneLineItemsTable } from "@/components/pricing/stone-line-items-table";
import { useSaveProductPricing, useRetryPriceSync } from "@/hooks/use-pricing";
import {
  computeFinalPrice,
  detectPricingCase,
  validatePricingInputs,
  parseStoneLineItems,
  sumStoneCharges,
  type MakingChargeMode,
  type StoneLineItem,
  type PriceInputs,
} from "@/lib/pricing";
import type { ProductRecord } from "@/types/product";

interface PricingPanelProps {
  productId: string;
  record: ProductRecord;
  ratePerGram: number;
  onPriced: (price: number) => void;
}

const MAKING_CHARGE_MODE_OPTIONS: { value: MakingChargeMode; label: string; hint: string }[] = [
  { value: "flat", label: "Flat (₹)", hint: "A fixed making charge, regardless of weight." },
  { value: "per_gram", label: "Per Gram (₹/g)", hint: "A rate applied per gram — see the case-specific formula below." },
];

/**
 * Gross/Net weight, making charge, stone/pearl line items, and the manual
 * override toggle — everything the Admin Pricing Dashboard spec's formulas
 * (src/lib/pricing.ts) need, plus a live preview of the resulting price.
 * Lives on Finalize, replacing what used to be a plain manual Price input:
 * the computed price still ends up in the same place (feeds Finalize's
 * canPublish/handlePublish), it's just derived instead of hand-typed unless
 * Manual Override is on.
 */
export function PricingPanel({ productId, record, ratePerGram, onPriced }: PricingPanelProps) {
  const [grossWeight, setGrossWeight] = useState("");
  const [netWeight, setNetWeight] = useState("");
  const [makingChargeMode, setMakingChargeMode] = useState<MakingChargeMode>("per_gram");
  const [makingChargeValue, setMakingChargeValue] = useState("");
  const [stoneLineItems, setStoneLineItems] = useState<StoneLineItem[]>([]);
  const [manualOverride, setManualOverride] = useState(false);
  const [overridePrice, setOverridePrice] = useState("");

  const savePricing = useSaveProductPricing();
  const retrySync = useRetryPriceSync();

  // Seed once from the loaded record, same pattern as Finalize's own
  // price/inventory fields — a background refetch shouldn't stomp on
  // whatever the user is mid-editing.
  const initialized = useRef(false);
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    setGrossWeight(record.weightGrams > 0 ? String(record.weightGrams) : "");
    setNetWeight(record.netWeightGrams > 0 ? String(record.netWeightGrams) : "");
    setMakingChargeMode(record.makingChargeMode);
    setMakingChargeValue(record.makingChargeValue > 0 ? String(record.makingChargeValue) : "");
    setStoneLineItems(parseStoneLineItems(record.stoneLineItems));
    setManualOverride(record.manualPriceOverride);
    setOverridePrice(record.manualPriceOverride && record.price > 0 ? String(record.price) : "");
  }, [record]);

  const priceInputs: PriceInputs = {
    grossWeightGrams: Number(grossWeight) || 0,
    netWeightGrams: Number(netWeight) || 0,
    ratePerGram,
    makingChargeMode,
    makingChargeValue: Number(makingChargeValue) || 0,
    stoneLineItems,
  };
  const pricingCase = detectPricingCase(priceInputs.grossWeightGrams, priceInputs.netWeightGrams);
  const validationError = validatePricingInputs(priceInputs);
  const computedPrice = computeFinalPrice(priceInputs);
  const overridePriceNumber = Number(overridePrice) || 0;
  const finalPrice = manualOverride ? overridePriceNumber : computedPrice;

  const canSave =
    !validationError &&
    (!manualOverride || overridePriceNumber > 0) &&
    ratePerGram > 0;

  async function handleSave() {
    try {
      const result = await savePricing.mutateAsync({
        productId,
        grossWeightGrams: priceInputs.grossWeightGrams,
        netWeightGrams: priceInputs.netWeightGrams,
        makingChargeMode,
        makingChargeValue: priceInputs.makingChargeValue,
        stoneLineItems,
        manualPriceOverride: manualOverride,
        manualPriceOverrideValue: manualOverride ? overridePriceNumber : undefined,
      });
      onPriced(result.price);
      if (result.priceSyncStatus === "out_of_sync") {
        toast.warning("Pricing saved, but syncing the price to Shopify failed — retry from below.");
      } else {
        toast.success("Pricing saved.");
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
        {ratePerGram <= 0 ? (
          <div className="flex items-center gap-2 rounded-xl border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-warning">
            <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
            No Rate/gram set yet — set it on Settings before pricing can be computed.
          </div>
        ) : null}

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Gross Weight (g)</Label>
            <Input type="number" min="0" step="0.01" value={grossWeight} onChange={(e) => setGrossWeight(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Net Weight (g)</Label>
            <Input type="number" min="0" step="0.01" value={netWeight} onChange={(e) => setNetWeight(e.target.value)} />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Making Charge Mode</Label>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {MAKING_CHARGE_MODE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setMakingChargeMode(option.value)}
                className={cn(
                  "flex flex-col items-start gap-0.5 rounded-xl border px-3 py-2 text-left transition-colors",
                  makingChargeMode === option.value ? "border-primary bg-accent" : "border-border hover:bg-secondary"
                )}
              >
                <span className="text-sm font-medium text-foreground">{option.label}</span>
                <span className="text-xs text-muted-foreground">{option.hint}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>{makingChargeMode === "flat" ? "Making Charge (₹)" : "Making Charge (₹/g)"}</Label>
          <Input
            type="number"
            min="0"
            step="0.01"
            value={makingChargeValue}
            onChange={(e) => setMakingChargeValue(e.target.value)}
          />
        </div>

        {pricingCase === "B" ? (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label>Stone/Pearl Line Items</Label>
              <span className="text-xs text-muted-foreground">
                Total: ₹{sumStoneCharges(stoneLineItems).toLocaleString("en-IN")}
              </span>
            </div>
            <StoneLineItemsTable items={stoneLineItems} onChange={setStoneLineItems} />
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            Gross and net weight match — stone/pearl weight is folded into the metal weight, so no separate stone
            charges apply.
          </p>
        )}

        <div className="flex items-center justify-between rounded-xl border border-border px-3 py-2.5">
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-medium text-foreground">Manual Price Override</span>
            <span className="text-xs text-muted-foreground">
              Hand-enter a fixed price instead — excluded from &quot;Update All Prices&quot;.
            </span>
          </div>
          <Switch checked={manualOverride} onCheckedChange={setManualOverride} />
        </div>

        {manualOverride ? (
          <div className="space-y-1.5">
            <Label>Override Price (₹)</Label>
            <Input type="number" min="0" step="1" value={overridePrice} onChange={(e) => setOverridePrice(e.target.value)} />
          </div>
        ) : null}

        {validationError ? (
          <p className="flex items-center gap-2 text-xs text-destructive">
            <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
            {validationError}
          </p>
        ) : null}

        <div className="flex items-center justify-between rounded-xl bg-secondary/50 px-4 py-3">
          <span className="text-sm text-muted-foreground">
            {manualOverride ? "Override price" : "Computed price"}
          </span>
          <span className="text-xl font-semibold text-foreground">₹{finalPrice.toLocaleString("en-IN")}</span>
        </div>

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
