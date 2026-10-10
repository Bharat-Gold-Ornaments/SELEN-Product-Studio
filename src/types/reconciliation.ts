export type ReconciliationSeverity = "error" | "warning" | "info";

export type ReconciliationRule =
  | "products_missing_from_shopify"
  | "inventory_shopify_id_not_found"
  | "sku_not_on_shopify_product"
  | "inventory_sku_on_other_product"
  | "product_sku_not_in_inventory"
  | "inventory_qty_mismatch"
  | "products_stock_mismatch"
  | "shopify_missing_from_products"
  | "shopify_missing_from_inventory"
  | "variant_without_sku"
  | "duplicate_shopify_sku"
  | "inventory_sku_not_on_shopify"
  | "inventory_shopify_id_blank"
  | "sku_spelling_differs"
  | "sold_out_still_active";

export interface ReconciliationRuleInfo {
  severity: ReconciliationSeverity;
  title: string;
  description: string;
}

/** In display order — most serious first. */
export const RECONCILIATION_RULES: Record<ReconciliationRule, ReconciliationRuleInfo> = {
  products_missing_from_shopify: {
    severity: "error",
    title: "In Products tab, not on Shopify",
    description: "The Products tab has a Shopify product ID that Shopify doesn't recognise — likely deleted from Shopify admin.",
  },
  inventory_shopify_id_not_found: {
    severity: "error",
    title: "Inventory Shopify ID not found",
    description: "An Inventory row's Shopify product ID doesn't exist on Shopify — a typo, or the product was deleted.",
  },
  sku_not_on_shopify_product: {
    severity: "error",
    title: "SKU not entered in Shopify admin",
    description: "The Inventory SKU is linked to this Shopify product, but none of the product's variants has that SKU.",
  },
  inventory_sku_on_other_product: {
    severity: "error",
    title: "SKU on a different Shopify product",
    description: "The Inventory row points at one Shopify product, but its SKU is on another one.",
  },
  product_sku_not_in_inventory: {
    severity: "error",
    title: "Product's SKU missing from Inventory",
    description: "A Products tab row was created from an Inventory SKU that no longer exists in Inventory.",
  },
  inventory_qty_mismatch: {
    severity: "error",
    title: "Inventory quantity ≠ Shopify stock",
    description: "The quantity on the Inventory tab doesn't match the stock on the Shopify variant with that SKU.",
  },
  products_stock_mismatch: {
    severity: "error",
    title: "Products tab stock ≠ Shopify stock",
    description: "The stock recorded on the Products tab doesn't match Shopify — usually stock changed directly in Shopify admin.",
  },
  shopify_missing_from_products: {
    severity: "warning",
    title: "On Shopify, not in Products tab",
    description: "Active Shopify products with no Products tab row — added to Shopify outside Product Studio.",
  },
  shopify_missing_from_inventory: {
    severity: "warning",
    title: "On Shopify, not in Inventory",
    description: "Active Shopify products with no Inventory row linked by Shopify ID or SKU, so their stock isn't tracked.",
  },
  variant_without_sku: {
    severity: "warning",
    title: "Shopify variants with no SKU",
    description: "Variants with an empty SKU in Shopify admin can't be matched to Inventory.",
  },
  duplicate_shopify_sku: {
    severity: "warning",
    title: "Same SKU on several Shopify variants",
    description: "One SKU is used by more than one variant, so its stock can't be matched to a single Inventory row.",
  },
  inventory_sku_not_on_shopify: {
    severity: "info",
    title: "Inventory SKU not on Shopify",
    description: "In Inventory but not on any active Shopify product — not listed yet.",
  },
  inventory_shopify_id_blank: {
    severity: "info",
    title: "Shopify ID blank on Inventory row",
    description: "The SKU was found on Shopify, but the Inventory row's Shopify product ID hasn't been filled in.",
  },
  sku_spelling_differs: {
    severity: "info",
    title: "SKU spelled differently",
    description: "Inventory and Shopify SKUs match only when capitals or spaces are ignored.",
  },
  sold_out_still_active: {
    severity: "info",
    title: "Sold out but still active",
    description: "Inventory quantity is 0 but the Shopify product is still active in the store.",
  },
};

export interface ReconciliationIssue {
  rule: ReconciliationRule;
  /** One-line explanation specific to this item. */
  message: string;
  shopifyProductId?: string;
  shopifyTitle?: string;
  shopifyAdminUrl?: string;
  sku?: string;
  /** Products tab productId, when the issue involves a Studio product. */
  productId?: string;
  productTitle?: string;
}

export interface ReconciliationReport {
  generatedAt: string;
  totals: {
    shopifyActive: number;
    /** Archived and draft products — left out of every check. */
    shopifyIgnored: number;
    productsWithShopifyId: number;
    inventoryRows: number;
  };
  issues: ReconciliationIssue[];
}
