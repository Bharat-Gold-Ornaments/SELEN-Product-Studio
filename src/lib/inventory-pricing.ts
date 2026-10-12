import {
  GST_RATE,
  applyGstAndRound,
  computeFinalPrice,
  parseStoneLineItems,
  serializeStoneLineItems,
  validatePricingInputs,
  type MakingChargeMode,
  type StoneLineItem,
} from "@/lib/pricing";
import type { InventoryItem } from "@/types/inventory";
import type { ProductRecord } from "@/types/product";

/**
 * An Inventory item's pricing inputs, in the shape the pricing formulas and
 * Finalize's save route use. The gross weight is the item's own weightGrams.
 */
export interface InventoryPricing {
  netWeightGrams: number;
  makingChargeMode: MakingChargeMode;
  makingChargeValue: number;
  stoneLineItems: StoneLineItem[];
  manualPriceOverride: boolean;
  /** Before GST; only used when manualPriceOverride is on. */
  manualPriceOverrideValue: number;
}

/** Priced once a net weight has been entered — the same "not yet entered" rule as ProductRecord. */
export function hasPricing(item: Pick<InventoryItem, "netWeightGrams">): boolean {
  return item.netWeightGrams > 0;
}

export function pricingOf(item: InventoryItem): InventoryPricing {
  return {
    netWeightGrams: item.netWeightGrams,
    makingChargeMode: item.makingChargeMode,
    makingChargeValue: item.makingChargeValue,
    stoneLineItems: parseStoneLineItems(item.stoneLineItems),
    manualPriceOverride: item.manualPriceOverride,
    manualPriceOverrideValue: item.manualPriceOverrideValue,
  };
}

/** The Inventory row fields that store `pricing`. */
export function pricingFields(pricing: InventoryPricing) {
  return {
    netWeightGrams: pricing.netWeightGrams,
    makingChargeMode: pricing.makingChargeMode,
    makingChargeValue: pricing.makingChargeValue,
    stoneLineItems: serializeStoneLineItems(pricing.stoneLineItems),
    manualPriceOverride: pricing.manualPriceOverride,
    manualPriceOverrideValue: pricing.manualPriceOverride ? pricing.manualPriceOverrideValue : 0,
  };
}

/** Why `pricing` can't be saved for a piece of this gross weight, or null. Same rules as Finalize. */
export function validateInventoryPricing(grossWeightGrams: number, pricing: InventoryPricing): string | null {
  const error = validatePricingInputs({
    grossWeightGrams,
    netWeightGrams: pricing.netWeightGrams,
    ratePerGram: 0, // not checked by validatePricingInputs
    makingChargeMode: pricing.makingChargeMode,
    makingChargeValue: pricing.makingChargeValue,
    stoneLineItems: pricing.stoneLineItems,
  });
  if (error) return error;
  if (pricing.manualPriceOverride && !(pricing.manualPriceOverrideValue > 0)) {
    return "Enter a manual override price greater than 0.";
  }
  return null;
}

/**
 * The sticker price at today's rate — GST-inclusive and rounded, exactly as
 * Finalize would compute it. Null when the item isn't priced, or no rate is
 * set and the price depends on it.
 */
export function inventoryPrice(item: InventoryItem, ratePerGram: number): number | null {
  if (!hasPricing(item)) return null;
  if (item.manualPriceOverride) {
    return item.manualPriceOverrideValue > 0 ? applyGstAndRound(item.manualPriceOverrideValue) : null;
  }
  if (!(ratePerGram > 0)) return null;
  return computeFinalPrice({
    grossWeightGrams: item.weightGrams,
    netWeightGrams: item.netWeightGrams,
    ratePerGram,
    makingChargeMode: item.makingChargeMode,
    makingChargeValue: item.makingChargeValue,
    stoneLineItems: parseStoneLineItems(item.stoneLineItems),
  });
}

/**
 * A product's saved pricing as Inventory pricing — used to fill in an
 * Inventory item that was never priced from the product already created
 * from it. Finalize only keeps the final price for an override, so the
 * pre-GST amount is backed out (the same estimate Finalize itself shows).
 */
export function pricingFromProduct(record: ProductRecord): InventoryPricing | null {
  if (!(record.netWeightGrams > 0)) return null;
  return {
    netWeightGrams: record.netWeightGrams,
    makingChargeMode: record.makingChargeMode,
    makingChargeValue: record.makingChargeValue,
    stoneLineItems: parseStoneLineItems(record.stoneLineItems),
    manualPriceOverride: record.manualPriceOverride,
    manualPriceOverrideValue: record.manualPriceOverride && record.price > 0 ? Math.round(record.price / (1 + GST_RATE)) : 0,
  };
}

/**
 * Reads pricing sent as JSON by the Inventory forms (multipart requests
 * carry it as one "pricing" field). Null if it's missing or malformed;
 * whether the values make sense is validateInventoryPricing's job.
 */
export function parseInventoryPricing(raw: unknown): InventoryPricing | null {
  if (typeof raw !== "string" || !raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<InventoryPricing>;
    const number = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? n : NaN);
    const stones = Array.isArray(value.stoneLineItems) ? value.stoneLineItems : [];
    const pricing: InventoryPricing = {
      netWeightGrams: number(value.netWeightGrams),
      makingChargeMode: value.makingChargeMode === "flat" ? "flat" : "per_gram",
      makingChargeValue: number(value.makingChargeValue),
      stoneLineItems: stones.map((s) => ({
        id: String(s?.id ?? ""),
        stoneType: String(s?.stoneType ?? ""),
        pricingMode: s?.pricingMode === "flat_per_piece" ? "flat_per_piece" : "by_weight",
        quantityOrWeight: Number(s?.quantityOrWeight) || 0,
        rate: Number(s?.rate) || 0,
      })),
      manualPriceOverride: value.manualPriceOverride === true,
      manualPriceOverrideValue: Number(value.manualPriceOverrideValue) || 0,
    };
    return Number.isNaN(pricing.netWeightGrams) || Number.isNaN(pricing.makingChargeValue) ? null : pricing;
  } catch {
    return null;
  }
}

/** One product created from an Inventory SKU, after that SKU's pricing was applied to it. */
export interface LinkedProductPriceResult {
  productId: string;
  title: string;
  /** New price, or null when it couldn't be saved (see `error`). */
  price: number | null;
  /** "synced" when the new price reached Shopify; "out_of_sync" when that push failed; "" when not published. */
  priceSyncStatus: "synced" | "out_of_sync" | "";
  error?: string;
}
