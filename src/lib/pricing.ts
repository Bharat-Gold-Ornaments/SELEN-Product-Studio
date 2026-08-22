/**
 * Pure pricing calculations for the Admin Pricing Dashboard feature — no
 * side effects, safe to import from both client components (live preview
 * while editing) and server routes (the authoritative calculation before
 * saving/syncing). See SELEN_Admin_Pricing_Dashboard_Spec.md for the
 * business rules this implements.
 */

export type MakingChargeMode = "flat" | "per_gram";
export type StonePricingMode = "by_weight" | "flat_per_piece";
export type PricingCase = "A" | "B";

export interface StoneLineItem {
  /** Client-generated id for React keys/editing — never persisted as a meaningful identifier beyond this product's own list. */
  id: string;
  stoneType: string;
  pricingMode: StonePricingMode;
  quantityOrWeight: number;
  rate: number;
}

/** ProductRecord.stoneLineItems is stored as a JSON string (Sheets has no native array-of-objects column) — this is the one canonical parse used by both the client pricing panel and the server pricing service, so the two can never silently disagree on the format. Malformed/empty input parses to an empty list rather than throwing. */
export function parseStoneLineItems(json: string): StoneLineItem[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? (parsed as StoneLineItem[]) : [];
  } catch {
    return [];
  }
}

export function serializeStoneLineItems(items: StoneLineItem[]): string {
  return JSON.stringify(items);
}

export function stoneLineItemAmount(item: StoneLineItem): number {
  return item.quantityOrWeight * item.rate;
}

export function sumStoneCharges(items: StoneLineItem[]): number {
  return items.reduce((sum, item) => sum + stoneLineItemAmount(item), 0);
}

/**
 * Case A/B is auto-detected by comparing Gross and Net weight, never
 * manually chosen — Case A means the stone/pearl weight was folded into the
 * metal weight (no separate stone cost), Case B means they were weighed
 * separately and stone/pearl line items apply.
 */
export function detectPricingCase(grossWeightGrams: number, netWeightGrams: number): PricingCase {
  return grossWeightGrams === netWeightGrams ? "A" : "B";
}

export interface PriceInputs {
  grossWeightGrams: number;
  netWeightGrams: number;
  ratePerGram: number;
  makingChargeMode: MakingChargeMode;
  makingChargeValue: number;
  stoneLineItems: StoneLineItem[];
}

/**
 * The four formulas from the spec, applied exactly as specified. Per-gram
 * making charge is always computed on Net Weight, in both cases — in Case A
 * that's the same value as Gross Weight anyway (gross === net is how Case A
 * gets detected in the first place), and in Case B it deliberately excludes
 * the stone/pearl weight, since that weight is already priced on its own
 * via the stone/pearl line items — charging labor on gross weight too would
 * bill the stones' weight twice. Returns the raw (unrounded) price — see
 * roundToCharmPrice for the final sticker-price rounding step.
 */
export function computeRawPrice(inputs: PriceInputs): number {
  const pricingCase = detectPricingCase(inputs.grossWeightGrams, inputs.netWeightGrams);

  if (pricingCase === "A") {
    return inputs.makingChargeMode === "flat"
      ? inputs.grossWeightGrams * inputs.ratePerGram + inputs.makingChargeValue
      : inputs.grossWeightGrams * (inputs.ratePerGram + inputs.makingChargeValue);
  }

  const stoneCharges = sumStoneCharges(inputs.stoneLineItems);
  return inputs.makingChargeMode === "flat"
    ? inputs.netWeightGrams * inputs.ratePerGram + inputs.makingChargeValue + stoneCharges
    : inputs.netWeightGrams * inputs.ratePerGram + inputs.netWeightGrams * inputs.makingChargeValue + stoneCharges;
}

/**
 * Charm-pricing rounding: UP to the next ₹100, then ₹1 under it (e.g.
 * 4,230 → 4,299; 380 → 399; 950 → 999; 4,200 → 4,199) — always rounds up,
 * never down, so the final sticker price is never less than the raw
 * computed cost (rounding to the *nearest* hundred could round a raw price
 * like 4,230 down to 4,199, undercharging by 31). Floors at ₹99 for any raw
 * price small enough to round up to ₹0 or less, so this never returns a
 * non-positive price.
 */
export function roundToCharmPrice(rawPrice: number): number {
  if (rawPrice <= 0) return 0;
  const nextHundred = Math.ceil(rawPrice / 100) * 100;
  return Math.max(nextHundred, 100) - 1;
}

export function computeFinalPrice(inputs: PriceInputs): number {
  return roundToCharmPrice(computeRawPrice(inputs));
}

/**
 * Hard validation rules from the spec (Section 6) — every one of these
 * blocks saving, never just warns. Returns the first violated rule's
 * message, or null if `inputs` is save-ready. Shared between the client
 * form (instant feedback) and the server route (never trusts the client
 * alone) so the two can never drift apart.
 */
export function validatePricingInputs(inputs: PriceInputs): string | null {
  if (!(inputs.grossWeightGrams > 0)) return "Gross weight is required and must be greater than 0.";
  if (!(inputs.netWeightGrams > 0)) return "Net weight is required and must be greater than 0.";
  if (inputs.netWeightGrams > inputs.grossWeightGrams) return "Net weight can't be greater than gross weight.";
  if (detectPricingCase(inputs.grossWeightGrams, inputs.netWeightGrams) === "B" && inputs.stoneLineItems.length === 0) {
    return "Gross and net weight differ — please add stone/pearl details before saving.";
  }
  if (!(inputs.makingChargeValue >= 0)) return "Making charge must be 0 or greater.";
  return null;
}
