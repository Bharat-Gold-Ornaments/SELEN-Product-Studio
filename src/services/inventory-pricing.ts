import "server-only";
import { listInventoryItems, listProducts } from "@/services/google-sheets";
import { readAppSettings } from "@/services/app-settings";
import { saveProductPricing } from "@/services/pricing";
import { hasPricing, inventoryPrice, pricingOf, type LinkedProductPriceResult } from "@/lib/inventory-pricing";
import { sameSku } from "@/lib/sku";
import type { InventoryItem } from "@/types/inventory";
import type { ProductRecord } from "@/types/product";

export type { LinkedProductPriceResult };

/**
 * Copies an Inventory SKU's pricing to every Studio product created from it
 * and pushes each new price to Shopify (through saveProductPricing, the
 * same path as Finalize's Save Pricing). This is what keeps Inventory, the
 * Products tab and Shopify on one price. Per product, a failure is reported
 * rather than thrown — the Inventory save itself already succeeded.
 */
export async function applyInventoryPricingToProducts(
  sku: string,
  options: { exceptProductId?: string } = {}
): Promise<LinkedProductPriceResult[]> {
  const [inventory, products, settings] = await Promise.all([listInventoryItems(), listProducts(), readAppSettings()]);
  const item = inventory.find((i) => sameSku(i.sku, sku));
  if (!item || !hasPricing(item)) return [];

  const linked = products.filter(
    (p) => p.sku && sameSku(p.sku, item.sku) && p.productId !== options.exceptProductId
  );
  const pricing = pricingOf(item);
  const results: LinkedProductPriceResult[] = [];

  for (const product of linked) {
    if (!pricing.manualPriceOverride && !(settings.ratePerGram > 0)) {
      results.push({
        productId: product.productId,
        title: product.title,
        price: null,
        priceSyncStatus: product.priceSyncStatus,
        error: "No Rate/gram set in Settings, so the price can't be computed.",
      });
      continue;
    }
    try {
      const result = await saveProductPricing(
        product.productId,
        {
          grossWeightGrams: item.weightGrams,
          netWeightGrams: pricing.netWeightGrams,
          makingChargeMode: pricing.makingChargeMode,
          makingChargeValue: pricing.makingChargeValue,
          stoneLineItems: pricing.stoneLineItems,
          manualPriceOverride: pricing.manualPriceOverride,
          manualPriceOverrideValue: pricing.manualPriceOverride ? pricing.manualPriceOverrideValue : undefined,
        },
        { syncInventory: false }
      );
      results.push({ productId: product.productId, title: product.title, ...result });
    } catch (error) {
      console.error(`Couldn't apply ${item.sku}'s pricing to product ${product.productId}`, error);
      results.push({
        productId: product.productId,
        title: product.title,
        price: null,
        priceSyncStatus: product.priceSyncStatus,
        error: error instanceof Error ? error.message : "Couldn't save pricing.",
      });
    }
  }
  return results;
}

/**
 * The pricing fields a new product copies from its Inventory SKU, with the
 * price computed at today's rate. Empty when the SKU isn't priced. The
 * gross weight comes along too, since the price is based on it.
 */
export async function pricingFromInventory(item: InventoryItem | undefined): Promise<Partial<ProductRecord>> {
  if (!item || !hasPricing(item)) return {};
  const settings = await readAppSettings();
  return {
    weightGrams: item.weightGrams,
    netWeightGrams: item.netWeightGrams,
    makingChargeMode: item.makingChargeMode,
    makingChargeValue: item.makingChargeValue,
    stoneLineItems: item.stoneLineItems,
    manualPriceOverride: item.manualPriceOverride,
    price: inventoryPrice(item, settings.ratePerGram) ?? 0,
  };
}
