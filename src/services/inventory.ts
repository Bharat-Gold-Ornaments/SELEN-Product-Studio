import "server-only";
import { findProduct, updateProductRow } from "@/services/google-sheets";
import { updateShopifyProductInventory } from "@/services/shopify";
import type { ProductRecord } from "@/types/product";

export interface SaveProductInventoryResult {
  inventory: number;
  inventorySyncStatus: ProductRecord["inventorySyncStatus"];
  inventorySyncedAt: string;
}

/**
 * Saves Finalize's plain (no-variants) Inventory field and — per this
 * project's "sync immediately on save" decision, same as
 * services/pricing.ts's saveProductPricing and services/variants.ts's
 * saveProductVariants — pushes it to Shopify right away if the product is
 * already published. A push failure doesn't fail the save: the value is
 * still persisted to the Sheet, just flagged `inventorySyncStatus:
 * "out_of_sync"` for a manual retry. Only ever called for a variant-less
 * product — one using real Color/Size variants keeps its stock in sync via
 * saveProductVariants instead (see Finalize's Inventory card, which only
 * shows this field when there are no variants).
 */
export async function saveProductInventory(productId: string, inventory: number): Promise<SaveProductInventoryResult> {
  const lookup = await findProduct(productId);
  if (!lookup) throw new Error("Product not found.");
  const { record } = lookup;

  let inventorySyncStatus = record.inventorySyncStatus;
  let inventorySyncedAt = record.inventorySyncedAt;

  if (record.shopifyProductId) {
    try {
      await updateShopifyProductInventory({ shopifyProductId: record.shopifyProductId, inventory });
      inventorySyncStatus = "synced";
      inventorySyncedAt = new Date().toISOString();
    } catch (error) {
      inventorySyncStatus = "out_of_sync";
      console.error(`Couldn't sync inventory to Shopify for product ${productId}:`, error);
    }
  }

  await updateProductRow(productId, { inventory, inventorySyncStatus, inventorySyncedAt });
  return { inventory, inventorySyncStatus, inventorySyncedAt };
}

/**
 * Retries syncing whatever inventory count is already saved for a product
 * flagged `inventorySyncStatus: "out_of_sync"` — the manual re-push
 * counterpart to retryPriceSync in services/pricing.ts. Doesn't recompute
 * anything; it resends exactly what's already in the sheet.
 */
export async function retryInventorySync(productId: string): Promise<SaveProductInventoryResult> {
  const lookup = await findProduct(productId);
  if (!lookup) throw new Error("Product not found.");
  const { record } = lookup;

  if (!record.shopifyProductId) {
    throw new Error("This product hasn't been published to Shopify yet.");
  }

  await updateShopifyProductInventory({ shopifyProductId: record.shopifyProductId, inventory: record.inventory });

  const inventorySyncedAt = new Date().toISOString();
  await updateProductRow(productId, { inventorySyncStatus: "synced", inventorySyncedAt });
  return { inventory: record.inventory, inventorySyncStatus: "synced", inventorySyncedAt };
}
