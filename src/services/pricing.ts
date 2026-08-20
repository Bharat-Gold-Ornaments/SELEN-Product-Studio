import "server-only";
import { readAppSettings, writeAppSettings } from "@/services/app-settings";
import { readConfigFile, writeConfigFile } from "@/services/google-drive";
import { listProducts, updateProductRow, findProduct } from "@/services/google-sheets";
import { updateShopifyProductPrice } from "@/services/shopify";
import {
  computeFinalPrice,
  validatePricingInputs,
  parseStoneLineItems,
  serializeStoneLineItems,
  type PriceInputs,
  type StoneLineItem,
  type MakingChargeMode,
} from "@/lib/pricing";
import type { ProductRecord } from "@/types/product";

const RATE_LOG_FILE = "rate-log.json";

export interface RateChangeLogEntry {
  timestamp: string;
  oldRate: number;
  newRate: number;
  /** Always "admin" — this app has one shared ADMIN_PASSWORD and no per-user accounts, so there's no real identity to attribute a change to beyond that. */
  changedBy: string;
}

/** Newest first — Settings' rate log view reads this directly, no client-side sorting needed. */
export async function getRateChangeLog(): Promise<RateChangeLogEntry[]> {
  const raw = await readConfigFile(RATE_LOG_FILE);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as RateChangeLogEntry[];
  } catch {
    return [];
  }
}

async function appendRateChangeLog(entry: RateChangeLogEntry): Promise<void> {
  const current = await getRateChangeLog();
  await writeConfigFile(RATE_LOG_FILE, JSON.stringify([entry, ...current], null, 2));
}

/**
 * The one audited path for changing Rate/gram (spec Section 9) — writeAppSettings
 * itself stays a plain, unaudited settings writer (see its doc comment), so
 * every rate change that should show up in the log has to go through here,
 * not through the generic settings PATCH.
 */
export async function updateGlobalRate(newRate: number): Promise<number> {
  if (!(newRate > 0)) throw new Error("Rate/gram must be a positive number.");
  const current = await readAppSettings();
  const oldRate = current.ratePerGram;
  await writeAppSettings({ ratePerGram: newRate });
  if (oldRate !== newRate) {
    await appendRateChangeLog({ timestamp: new Date().toISOString(), oldRate, newRate, changedBy: "admin" });
  }
  return newRate;
}

function priceInputsFromRecord(record: ProductRecord, ratePerGram: number): PriceInputs {
  return {
    grossWeightGrams: record.weightGrams,
    netWeightGrams: record.netWeightGrams,
    ratePerGram,
    makingChargeMode: record.makingChargeMode,
    makingChargeValue: record.makingChargeValue,
    stoneLineItems: parseStoneLineItems(record.stoneLineItems),
  };
}

export interface SaveProductPricingInput {
  grossWeightGrams: number;
  netWeightGrams: number;
  makingChargeMode: MakingChargeMode;
  makingChargeValue: number;
  stoneLineItems: StoneLineItem[];
  manualPriceOverride: boolean;
  /** Required (and used as the final price) when manualPriceOverride is true — ignored otherwise. */
  manualPriceOverrideValue?: number;
}

export interface SaveProductPricingResult {
  price: number;
  priceSyncStatus: ProductRecord["priceSyncStatus"];
  priceSyncedAt: string;
}

/**
 * Saves one product's pricing fields, computes the price (or takes the
 * manual override value as-is), and — per this project's "sync
 * immediately on save" decision — pushes it to Shopify right away if the
 * product is already published. A push failure doesn't fail the save: the
 * pricing data and computed price are still persisted, just flagged
 * `priceSyncStatus: "out_of_sync"` for a manual retry (see
 * useRetrySync/the "out of sync" badge on Finalize).
 */
export async function saveProductPricing(
  productId: string,
  input: SaveProductPricingInput
): Promise<SaveProductPricingResult> {
  const settings = await readAppSettings();
  const priceInputs: PriceInputs = {
    grossWeightGrams: input.grossWeightGrams,
    netWeightGrams: input.netWeightGrams,
    ratePerGram: settings.ratePerGram,
    makingChargeMode: input.makingChargeMode,
    makingChargeValue: input.makingChargeValue,
    stoneLineItems: input.stoneLineItems,
  };

  const validationError = validatePricingInputs(priceInputs);
  if (validationError) throw new Error(validationError);

  let price: number;
  if (input.manualPriceOverride) {
    if (!(input.manualPriceOverrideValue && input.manualPriceOverrideValue > 0)) {
      throw new Error("Enter a manual override price greater than 0.");
    }
    price = input.manualPriceOverrideValue;
  } else {
    price = computeFinalPrice(priceInputs);
  }

  const lookup = await findProduct(productId);
  if (!lookup) throw new Error("Product not found.");

  let priceSyncStatus = lookup.record.priceSyncStatus;
  let priceSyncedAt = lookup.record.priceSyncedAt;

  if (lookup.record.shopifyProductId) {
    try {
      await updateShopifyProductPrice({
        shopifyProductId: lookup.record.shopifyProductId,
        price,
        grossWeightGrams: input.grossWeightGrams,
      });
      priceSyncStatus = "synced";
      priceSyncedAt = new Date().toISOString();
    } catch (error) {
      priceSyncStatus = "out_of_sync";
      console.error(`Couldn't sync price to Shopify for product ${productId}:`, error);
    }
  }

  await updateProductRow(productId, {
    weightGrams: input.grossWeightGrams,
    netWeightGrams: input.netWeightGrams,
    makingChargeMode: input.makingChargeMode,
    makingChargeValue: input.makingChargeValue,
    stoneLineItems: serializeStoneLineItems(input.stoneLineItems),
    manualPriceOverride: input.manualPriceOverride,
    price,
    priceSyncStatus,
    priceSyncedAt,
  });

  return { price, priceSyncStatus, priceSyncedAt };
}

/**
 * Retries syncing whatever price/weight is already saved for a product
 * that's flagged `priceSyncStatus: "out_of_sync"` — the manual re-push this
 * project's "flag + manual retry" failure-handling decision calls for.
 * Doesn't recompute anything; it resends exactly what's already in the
 * sheet, since the failure was a Shopify-side/network problem, not stale
 * data.
 */
export async function retryPriceSync(productId: string): Promise<SaveProductPricingResult> {
  const lookup = await findProduct(productId);
  if (!lookup) throw new Error("Product not found.");
  if (!lookup.record.shopifyProductId) {
    throw new Error("This product hasn't been published to Shopify yet.");
  }

  await updateShopifyProductPrice({
    shopifyProductId: lookup.record.shopifyProductId,
    price: lookup.record.price,
    grossWeightGrams: lookup.record.weightGrams,
  });

  const priceSyncedAt = new Date().toISOString();
  await updateProductRow(productId, { priceSyncStatus: "synced", priceSyncedAt });
  return { price: lookup.record.price, priceSyncStatus: "synced", priceSyncedAt };
}

export interface UpdateAllPricesResult {
  ratePerGram: number;
  updated: number;
  skipped: number;
  failed: { productId: string; message: string }[];
}

/**
 * The "Update All Prices" bulk action (spec Section 7): updates the global
 * rate (audited via updateGlobalRate above), then recalculates every
 * product's price using its own already-saved weight/making-charge/stone
 * values — never touching those values themselves, only the metal-cost
 * component the new rate feeds into. Products flagged `manualPriceOverride`
 * are skipped entirely, matching Section 8. Products that pre-date this
 * feature (never given a net weight) are also skipped rather than failed —
 * there's nothing to recompute for them yet. Already-published products get
 * their new price pushed to Shopify immediately; not-yet-published ones
 * just get their stored price refreshed so it's current whenever they
 * eventually are published.
 */
export async function updateAllPrices(newRate: number): Promise<UpdateAllPricesResult> {
  await updateGlobalRate(newRate);

  const products = await listProducts();
  let updated = 0;
  let skipped = 0;
  const failed: { productId: string; message: string }[] = [];

  for (const record of products) {
    if (record.manualPriceOverride) {
      skipped++;
      continue;
    }
    if (!(record.weightGrams > 0) || !(record.netWeightGrams > 0)) {
      skipped++;
      continue;
    }

    try {
      const priceInputs = priceInputsFromRecord(record, newRate);
      const validationError = validatePricingInputs(priceInputs);
      if (validationError) {
        failed.push({ productId: record.productId, message: validationError });
        continue;
      }
      const price = computeFinalPrice(priceInputs);

      const patch: Partial<ProductRecord> = { price };
      if (record.shopifyProductId) {
        try {
          await updateShopifyProductPrice({ shopifyProductId: record.shopifyProductId, price });
          patch.priceSyncStatus = "synced";
          patch.priceSyncedAt = new Date().toISOString();
        } catch (error) {
          patch.priceSyncStatus = "out_of_sync";
          console.error(`Couldn't sync price to Shopify for product ${record.productId}:`, error);
        }
      }

      await updateProductRow(record.productId, patch);
      updated++;
    } catch (error) {
      failed.push({
        productId: record.productId,
        message: error instanceof Error ? error.message : "Unknown error.",
      });
    }
  }

  return { ratePerGram: newRate, updated, skipped, failed };
}
