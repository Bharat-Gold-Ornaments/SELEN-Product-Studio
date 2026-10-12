"use client";

import { TriangleAlert } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { StoneLineItemsTable } from "@/components/pricing/stone-line-items-table";
import {
  applyGstAndRound,
  computePriceBreakdown,
  detectPricingCase,
  validatePricingInputs,
  sumStoneCharges,
  GST_RATE,
  type MakingChargeMode,
  type StoneLineItem,
  type PriceInputs,
  type PriceBreakdown,
  type PricingCase,
} from "@/lib/pricing";
import type { InventoryPricing } from "@/lib/inventory-pricing";

/** The pricing form's values as typed — numbers stay strings until saved. */
export interface PricingDraft {
  grossWeight: string;
  netWeight: string;
  makingChargeMode: MakingChargeMode;
  makingChargeValue: string;
  stoneLineItems: StoneLineItem[];
  manualOverride: boolean;
  /** Before GST. */
  overridePrice: string;
}

export const EMPTY_PRICING_DRAFT: PricingDraft = {
  grossWeight: "",
  netWeight: "",
  makingChargeMode: "per_gram",
  makingChargeValue: "",
  stoneLineItems: [],
  manualOverride: false,
  overridePrice: "",
};

export interface PricingState {
  priceInputs: PriceInputs;
  pricingCase: PricingCase;
  validationError: string | null;
  overridePriceNumber: number;
  breakdown: PriceBreakdown;
  /** Valid and, for a computed price, a rate is set. */
  canSave: boolean;
}

/** Everything derived from a draft: inputs for the formulas, validation, and the price breakdown. */
export function pricingState(draft: PricingDraft, ratePerGram: number): PricingState {
  const priceInputs: PriceInputs = {
    grossWeightGrams: Number(draft.grossWeight) || 0,
    netWeightGrams: Number(draft.netWeight) || 0,
    ratePerGram,
    makingChargeMode: draft.makingChargeMode,
    makingChargeValue: Number(draft.makingChargeValue) || 0,
    stoneLineItems: draft.stoneLineItems,
  };
  const overridePriceNumber = Number(draft.overridePrice) || 0;
  // Override mode has no metal/making/stone split — just its own pre-GST
  // amount, GST, and the resulting total — so it's modelled as a
  // PriceBreakdown too, letting the summary stay one path.
  const overrideGst = overridePriceNumber * GST_RATE;
  const breakdown: PriceBreakdown = draft.manualOverride
    ? {
        metalCost: 0,
        makingCharge: 0,
        stoneCharges: 0,
        subtotal: overridePriceNumber,
        gst: overrideGst,
        priceWithGst: overridePriceNumber + overrideGst,
        total: applyGstAndRound(overridePriceNumber),
      }
    : computePriceBreakdown(priceInputs);
  const validationError = validatePricingInputs(priceInputs);
  return {
    priceInputs,
    pricingCase: detectPricingCase(priceInputs.grossWeightGrams, priceInputs.netWeightGrams),
    validationError,
    overridePriceNumber,
    breakdown,
    canSave: !validationError && (draft.manualOverride ? overridePriceNumber > 0 : ratePerGram > 0),
  };
}

/** The draft as the Inventory routes take it (gross weight travels separately, as the item's weight). */
export function draftToInventoryPricing(draft: PricingDraft): InventoryPricing {
  return {
    netWeightGrams: Number(draft.netWeight) || 0,
    makingChargeMode: draft.makingChargeMode,
    makingChargeValue: Number(draft.makingChargeValue) || 0,
    stoneLineItems: draft.stoneLineItems,
    manualPriceOverride: draft.manualOverride,
    manualPriceOverrideValue: draft.manualOverride ? Number(draft.overridePrice) || 0 : 0,
  };
}

export function draftFromInventoryPricing(grossWeightGrams: number, pricing: InventoryPricing): PricingDraft {
  return {
    grossWeight: grossWeightGrams > 0 ? String(grossWeightGrams) : "",
    netWeight: pricing.netWeightGrams > 0 ? String(pricing.netWeightGrams) : "",
    makingChargeMode: pricing.makingChargeMode,
    makingChargeValue: pricing.makingChargeValue > 0 ? String(pricing.makingChargeValue) : "",
    stoneLineItems: pricing.stoneLineItems,
    manualOverride: pricing.manualPriceOverride,
    overridePrice: pricing.manualPriceOverride && pricing.manualPriceOverrideValue > 0 ? String(pricing.manualPriceOverrideValue) : "",
  };
}

const MAKING_CHARGE_MODE_OPTIONS: { value: MakingChargeMode; label: string; hint: string }[] = [
  { value: "flat", label: "Flat (₹)", hint: "A fixed making charge, regardless of weight." },
  { value: "per_gram", label: "Per Gram (₹/g)", hint: "A rate applied per gram — see the case-specific formula below." },
];

const rupees = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

interface PricingFieldsProps {
  draft: PricingDraft;
  onChange: (patch: Partial<PricingDraft>) => void;
  ratePerGram: number;
  /**
   * False where the gross weight is entered elsewhere on the form (the
   * Inventory forms' own Weight field) — the draft's grossWeight is then
   * kept in step by the caller.
   */
  showGrossWeight?: boolean;
}

/**
 * Gross/Net weight, making charge, stone/pearl line items and the manual
 * override, with a live price breakdown — the formulas in src/lib/pricing.ts.
 * Shared by Finalize's pricing panel and the Inventory forms, so a piece is
 * priced the same way in both places.
 */
export function PricingFields({ draft, onChange, ratePerGram, showGrossWeight = true }: PricingFieldsProps) {
  const { pricingCase, validationError, breakdown } = pricingState(draft, ratePerGram);

  return (
    <div className="flex flex-col gap-5">
      {ratePerGram <= 0 && !draft.manualOverride ? (
        <div className="flex items-center gap-2 rounded-xl border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-warning">
          <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
          No Rate/gram set yet — set it on Settings before pricing can be computed.
        </div>
      ) : null}

      <div className={cn("grid gap-3", showGrossWeight ? "grid-cols-2" : "grid-cols-1 sm:grid-cols-2")}>
        {showGrossWeight ? (
          <div className="space-y-1.5">
            <Label>Gross Weight (g)</Label>
            <Input
              type="number"
              min="0"
              step="0.01"
              value={draft.grossWeight}
              onChange={(e) => onChange({ grossWeight: e.target.value })}
            />
          </div>
        ) : null}
        <div className="space-y-1.5">
          <Label>Net Weight (g)</Label>
          <Input
            type="number"
            min="0"
            step="0.01"
            value={draft.netWeight}
            onChange={(e) => onChange({ netWeight: e.target.value })}
          />
          {!showGrossWeight ? (
            <p className="text-xs text-muted-foreground">Metal only. Same as the weight above if there are no stones.</p>
          ) : null}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Making Charge Mode</Label>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {MAKING_CHARGE_MODE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => onChange({ makingChargeMode: option.value })}
              className={cn(
                "flex flex-col items-start gap-0.5 rounded-xl border px-3 py-2 text-left transition-colors",
                draft.makingChargeMode === option.value ? "border-primary bg-accent" : "border-border hover:bg-secondary"
              )}
            >
              <span className="text-sm font-medium text-foreground">{option.label}</span>
              <span className="text-xs text-muted-foreground">{option.hint}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>{draft.makingChargeMode === "flat" ? "Making Charge (₹)" : "Making Charge (₹/g)"}</Label>
        <Input
          type="number"
          min="0"
          step="0.01"
          value={draft.makingChargeValue}
          onChange={(e) => onChange({ makingChargeValue: e.target.value })}
        />
      </div>

      {pricingCase === "B" ? (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label>Stone/Pearl Line Items</Label>
            <span className="text-xs text-muted-foreground">
              Total: ₹{sumStoneCharges(draft.stoneLineItems).toLocaleString("en-IN")}
            </span>
          </div>
          <StoneLineItemsTable items={draft.stoneLineItems} onChange={(stoneLineItems) => onChange({ stoneLineItems })} />
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          Gross and net weight match — stone/pearl weight is folded into the metal weight, so no separate stone charges
          apply.
        </p>
      )}

      <div className="flex items-center justify-between rounded-xl border border-border px-3 py-2.5">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-medium text-foreground">Manual Price Override</span>
          <span className="text-xs text-muted-foreground">
            Hand-enter a fixed price instead — excluded from &quot;Update All Prices&quot;.
          </span>
        </div>
        <Switch checked={draft.manualOverride} onCheckedChange={(manualOverride) => onChange({ manualOverride })} />
      </div>

      {draft.manualOverride ? (
        <div className="space-y-1.5">
          <Label>Override Price, before GST (₹)</Label>
          <Input
            type="number"
            min="0"
            step="1"
            value={draft.overridePrice}
            onChange={(e) => onChange({ overridePrice: e.target.value })}
          />
        </div>
      ) : null}

      {validationError ? (
        <p className="flex items-center gap-2 text-xs text-destructive">
          <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
          {validationError}
        </p>
      ) : null}

      <div className="space-y-1.5 rounded-xl border border-border px-4 py-3 text-sm">
        {draft.manualOverride ? null : (
          <>
            <div className="flex items-center justify-between text-muted-foreground">
              <span>Metal cost</span>
              <span>{rupees(breakdown.metalCost)}</span>
            </div>
            <div className="flex items-center justify-between text-muted-foreground">
              <span>Making charge</span>
              <span>{rupees(breakdown.makingCharge)}</span>
            </div>
            {pricingCase === "B" ? (
              <div className="flex items-center justify-between text-muted-foreground">
                <span>Stone/pearl charges</span>
                <span>{rupees(breakdown.stoneCharges)}</span>
              </div>
            ) : null}
          </>
        )}
        <div className="flex items-center justify-between border-t border-border pt-1.5 text-muted-foreground">
          <span>Subtotal</span>
          <span>{rupees(breakdown.subtotal)}</span>
        </div>
        <div className="flex items-center justify-between text-muted-foreground">
          <span>GST ({(GST_RATE * 100).toFixed(0)}%)</span>
          <span>{rupees(breakdown.gst)}</span>
        </div>
        <div className="flex items-center justify-between border-t border-border pt-1.5 text-muted-foreground">
          <span>Computed price (incl. GST)</span>
          <span>{rupees(breakdown.priceWithGst)}</span>
        </div>
      </div>

      <div className="flex items-center justify-between rounded-xl bg-secondary/50 px-4 py-3">
        <span className="text-sm text-muted-foreground">Final price (rounded)</span>
        <span className="text-xl font-semibold text-foreground">₹{breakdown.total.toLocaleString("en-IN")}</span>
      </div>
    </div>
  );
}
