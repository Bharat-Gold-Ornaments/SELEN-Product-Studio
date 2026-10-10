import "server-only";
import { listInventoryItems, listProducts } from "@/services/google-sheets";
import {
  listShopifyProductsForReconciliation,
  shopifyAdminProductUrl,
  type ShopifyReconciliationProduct,
  type ShopifyReconciliationVariant,
} from "@/services/shopify";
import { normalizeSku } from "@/lib/sku";
import { parseVariantRows, totalVariantInventory } from "@/lib/variants";
import type { ProductRecord } from "@/types/product";
import type { ReconciliationIssue, ReconciliationReport, ReconciliationRule } from "@/types/reconciliation";

interface VariantMatch {
  product: ShopifyReconciliationProduct;
  variant: ShopifyReconciliationVariant;
}

/** Products tab stock in the same shape as Shopify's: summed across variants when the product has them. */
function productsTabStock(record: ProductRecord): number {
  return record.variants ? totalVariantInventory(parseVariantRows(record.variants)) : record.inventory;
}

function shopifyStock(product: ShopifyReconciliationProduct): number {
  return product.variants.reduce((sum, v) => sum + v.inventoryQuantity, 0);
}

/**
 * Cross-checks Shopify, the Products tab and the Inventory tab. Read-only.
 * Archived and draft Shopify products are left out entirely: they're never
 * reported as missing, and Sheet rows pointing at them aren't flagged.
 */
export async function runReconciliation(): Promise<ReconciliationReport> {
  const [shopifyProducts, products, inventory] = await Promise.all([
    listShopifyProductsForReconciliation(),
    listProducts(),
    listInventoryItems(),
  ]);

  const issues: ReconciliationIssue[] = [];
  const raised = new Set<string>();
  /** Adds an issue unless the same rule already fired for the same key (e.g. product + SKU). */
  function raise(rule: ReconciliationRule, key: string, issue: Omit<ReconciliationIssue, "rule">) {
    const id = `${rule}|${key}`;
    if (raised.has(id)) return;
    raised.add(id);
    issues.push({ rule, ...issue });
  }
  const shopifyFields = (product: ShopifyReconciliationProduct) => ({
    shopifyProductId: product.shopifyProductId,
    shopifyTitle: product.title,
    shopifyAdminUrl: shopifyAdminProductUrl(product.shopifyProductId),
  });

  // ── Index Shopify ─────────────────────────────────────────────────────
  const allShopifyIds = new Set(shopifyProducts.map((p) => p.shopifyProductId));
  const active = shopifyProducts.filter((p) => p.status === "ACTIVE");
  const activeById = new Map(active.map((p) => [p.shopifyProductId, p]));
  const activeSkuIndex = new Map<string, VariantMatch[]>();
  for (const product of active) {
    for (const variant of product.variants) {
      if (!variant.sku.trim()) continue;
      const key = normalizeSku(variant.sku);
      activeSkuIndex.set(key, [...(activeSkuIndex.get(key) ?? []), { product, variant }]);
    }
  }
  const inactiveSkus = new Set(
    shopifyProducts
      .filter((p) => p.status !== "ACTIVE")
      .flatMap((p) => p.variants.map((v) => v.sku))
      .filter((sku) => sku.trim())
      .map(normalizeSku)
  );

  // ── Index the Sheet ───────────────────────────────────────────────────
  const productsWithShopifyId = products.filter((p) => p.shopifyProductId);
  const productIdsOnSheet = new Set(productsWithShopifyId.map((p) => p.shopifyProductId!.trim()));
  const inventorySkus = new Set(inventory.map((i) => normalizeSku(i.sku)));
  /** Active Shopify product IDs that the Products tab links to an Inventory SKU. */
  const productsTabSkuLinks = new Map<string, string>();
  for (const record of productsWithShopifyId) {
    if (record.sku) productsTabSkuLinks.set(normalizeSku(record.sku), record.shopifyProductId!.trim());
  }

  // ── Shopify products vs. both tabs ────────────────────────────────────
  for (const product of active) {
    const id = product.shopifyProductId;
    const variantSkus = product.variants.map((v) => v.sku).filter((sku) => sku.trim()).map(normalizeSku);

    if (!productIdsOnSheet.has(id)) {
      raise("shopify_missing_from_products", id, {
        ...shopifyFields(product),
        message: "Not in the Products tab — added to Shopify outside Product Studio.",
      });
    }

    const linkedToInventory =
      inventory.some((item) => item.shopifyProductId.trim() === id) ||
      variantSkus.some((sku) => inventorySkus.has(sku)) ||
      productsWithShopifyId.some(
        (record) => record.shopifyProductId!.trim() === id && record.sku && inventorySkus.has(normalizeSku(record.sku))
      );
    if (!linkedToInventory) {
      raise("shopify_missing_from_inventory", id, {
        ...shopifyFields(product),
        message: "No Inventory row has this Shopify ID or any of its SKUs.",
      });
    }

    const missingSku = product.variants.filter((v) => !v.sku.trim());
    if (missingSku.length > 0) {
      raise("variant_without_sku", id, {
        ...shopifyFields(product),
        message:
          product.variants.length === 1
            ? "The product's only variant has no SKU."
            : `${missingSku.length} of ${product.variants.length} variants have no SKU: ${missingSku.map((v) => v.title).join(", ")}.`,
      });
    }
  }

  for (const [sku, matches] of activeSkuIndex) {
    if (matches.length < 2) continue;
    raise("duplicate_shopify_sku", sku, {
      sku: matches[0].variant.sku,
      message: `Used by ${matches.length} variants: ${matches
        .map((m) => `${m.product.title}${m.product.variants.length > 1 ? ` (${m.variant.title})` : ""}`)
        .join(", ")}.`,
    });
  }

  // ── Products tab vs. Shopify and Inventory ───────────────────────────
  for (const record of productsWithShopifyId) {
    const id = record.shopifyProductId!.trim();
    const productFields = { productId: record.productId, productTitle: record.title };

    if (!allShopifyIds.has(id)) {
      raise("products_missing_from_shopify", record.productId, {
        ...productFields,
        shopifyProductId: id,
        sku: record.sku || undefined,
        message: `Shopify has no product ${id}.`,
      });
      continue;
    }
    const shopifyProduct = activeById.get(id);
    if (!shopifyProduct) continue; // archived or draft — ignored

    const sheetStock = productsTabStock(record);
    const liveStock = shopifyStock(shopifyProduct);
    if (sheetStock !== liveStock) {
      raise("products_stock_mismatch", record.productId, {
        ...productFields,
        ...shopifyFields(shopifyProduct),
        sku: record.sku || undefined,
        message: `Products tab says ${sheetStock}, Shopify has ${liveStock}.`,
      });
    }

    if (record.sku) {
      const sku = normalizeSku(record.sku);
      if (!inventorySkus.has(sku)) {
        raise("product_sku_not_in_inventory", record.productId, {
          ...productFields,
          ...shopifyFields(shopifyProduct),
          sku: record.sku,
          message: `Created from SKU ${record.sku}, which is no longer in Inventory.`,
        });
      }
      if (!shopifyProduct.variants.some((v) => v.sku.trim() && normalizeSku(v.sku) === sku)) {
        raise("sku_not_on_shopify_product", `${id}|${sku}`, {
          ...productFields,
          ...shopifyFields(shopifyProduct),
          sku: record.sku,
          message: `No variant of this product has SKU ${record.sku}.`,
        });
      }
    }
  }

  // ── Inventory rows vs. Shopify ────────────────────────────────────────
  for (const item of inventory) {
    const sku = normalizeSku(item.sku);
    const matches = activeSkuIndex.get(sku) ?? [];
    const linkedId = item.shopifyProductId.trim();
    let matched: VariantMatch | undefined;

    if (linkedId) {
      if (!allShopifyIds.has(linkedId)) {
        raise("inventory_shopify_id_not_found", item.sku, {
          sku: item.sku,
          shopifyProductId: linkedId,
          message: `Inventory row says Shopify product ${linkedId}, which doesn't exist on Shopify.`,
        });
        continue;
      }
      const linkedProduct = activeById.get(linkedId);
      if (!linkedProduct) continue; // archived or draft — ignored

      const onLinked = matches.filter((m) => m.product.shopifyProductId === linkedId);
      if (onLinked.length > 0) {
        matched = onLinked.length === 1 ? onLinked[0] : undefined;
      } else if (matches.length > 0) {
        raise("inventory_sku_on_other_product", item.sku, {
          sku: item.sku,
          ...shopifyFields(linkedProduct),
          message: `Inventory row points here, but SKU ${item.sku} is on ${matches
            .map((m) => `${m.product.title} (${m.product.shopifyProductId})`)
            .join(", ")}.`,
        });
      } else {
        raise("sku_not_on_shopify_product", `${linkedId}|${sku}`, {
          sku: item.sku,
          ...shopifyFields(linkedProduct),
          message: `No variant of this product has SKU ${item.sku}.`,
        });
      }
    } else if (matches.length > 0) {
      matched = matches.length === 1 ? matches[0] : undefined;
      raise("inventory_shopify_id_blank", item.sku, {
        sku: item.sku,
        ...shopifyFields(matches[0].product),
        message:
          matches.length === 1
            ? `SKU found on this product — its Shopify ID is ${matches[0].product.shopifyProductId}.`
            : `SKU found on ${matches.length} Shopify variants.`,
      });
    } else if (!inactiveSkus.has(sku) && !productsTabSkuLinks.has(sku)) {
      // A Products tab link to an active product is already reported above
      // as "SKU not entered in Shopify admin"; an archived/draft match is ignored.
      raise("inventory_sku_not_on_shopify", item.sku, {
        sku: item.sku,
        message: "Not on any active Shopify product.",
      });
    }

    if (!matched) continue;
    const productFields = shopifyFields(matched.product);
    if (item.quantity !== matched.variant.inventoryQuantity) {
      raise("inventory_qty_mismatch", item.sku, {
        sku: item.sku,
        ...productFields,
        message: `Inventory says ${item.quantity}, Shopify has ${matched.variant.inventoryQuantity}.`,
      });
    }
    if (matched.variant.sku !== item.sku) {
      raise("sku_spelling_differs", item.sku, {
        sku: item.sku,
        ...productFields,
        message: `Inventory has "${item.sku}", Shopify has "${matched.variant.sku}".`,
      });
    }
    if (item.quantity === 0) {
      raise("sold_out_still_active", item.sku, {
        sku: item.sku,
        ...productFields,
        message: "Quantity 0 in Inventory, but the product is still active on Shopify.",
      });
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    totals: {
      shopifyActive: active.length,
      shopifyIgnored: shopifyProducts.length - active.length,
      productsWithShopifyId: productsWithShopifyId.length,
      inventoryRows: inventory.length,
    },
    issues,
  };
}
