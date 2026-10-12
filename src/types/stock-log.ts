/**
 * Why a SKU's stock changed: `sale` (Sales page), `online_sale` (Shopify
 * order import), `restock` and `new` (Inventory page), `correction` (an
 * undo, a return, or a quantity edited by hand) and `merge` (two SKUs of
 * the same design combined into one).
 */
export type StockMovementType = "sale" | "online_sale" | "restock" | "new" | "correction" | "merge";

/**
 * Whether the change has reached Shopify's stock.
 * - `sent`: applied on Shopify.
 * - `pending`: should be on Shopify but isn't yet — the SKU couldn't be
 *   matched to one Shopify variant, or the push failed. Retried from the
 *   Sales page.
 * - `not_on_shopify`: the item isn't on Shopify, so there's nothing to send.
 * - `""`: not applicable — the change is never sent (Inventory page edits,
 *   or online sales, which Shopify already applied itself).
 */
export type ShopifyStockStatus = "sent" | "pending" | "not_on_shopify" | "";

/** One row of the Stock Log tab — a single stock change for one SKU. */
export interface StockLogEntry {
  id: string;
  /** Business day the change belongs to, YYYY-MM-DD — can differ from recordedAt when a day is entered late. */
  date: string;
  /** When it was entered, ISO timestamp. */
  recordedAt: string;
  type: StockMovementType;
  sku: string;
  /** Signed: −2 for two pieces sold, +5 for five received. */
  change: number;
  /** The Inventory tab quantity right after this change. */
  stockAfter: number;
  recordedBy: string;
  note: string;
  shopifyStatus: ShopifyStockStatus;
  /** Shopify order line for online sales; empty otherwise. */
  shopifyOrderRef: string;
  /** For an undo or a return: the id of the entry it reverses. */
  reversesId: string;
  /** For a merge: the other SKU — on the removed SKU's row, the one it was merged into. */
  relatedSku: string;
  /** For an online sale: the Shopify product (numeric id) and variant (gid) ordered. */
  shopifyProductRef: string;
  shopifyVariantRef: string;
}

export interface SaleLineInput {
  sku: string;
  quantity: number;
}

export interface RecordSalesInput {
  date: string;
  recordedBy: string;
  lines: SaleLineInput[];
}

export interface RecordSalesResult {
  entries: StockLogEntry[];
}
