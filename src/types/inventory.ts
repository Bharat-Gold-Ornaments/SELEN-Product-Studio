/**
 * Categories the Inventory page tracks. Values match ProductType where the
 * two overlap; "chain" is inventory-only (the studio doesn't generate chains).
 */
export type InventoryCategory = "ring" | "pendant" | "earrings" | "chain";

/** One row of the Google Sheet's Inventory tab — one SKU and how many of it are in stock. */
export interface InventoryItem {
  /** Unique per row. */
  sku: string;
  category: InventoryCategory;
  weightGrams: number;
  quantity: number;
  /** `/api/drive-image/{fileId}` proxy URL, or "" if no photo was attached. */
  photoUrl: string;
  shopifyProductId: string;
  createdDate: string;
  // Pricing — the same inputs as Finalize's pricing panel (src/lib/pricing.ts),
  // with `weightGrams` above as the gross weight. Kept in step with every
  // Studio product created from this SKU (services/inventory-pricing.ts).
  // netWeightGrams 0 means the item hasn't been priced yet.
  netWeightGrams: number;
  makingChargeMode: "flat" | "per_gram";
  makingChargeValue: number;
  /** JSON-serialized StoneLineItem[], same format as ProductRecord.stoneLineItems. */
  stoneLineItems: string;
  manualPriceOverride: boolean;
  /** The typed override price, before GST. Only used when manualPriceOverride is on. */
  manualPriceOverrideValue: number;
  /**
   * The sticker price (GST-inclusive, rounded) these inputs give at the
   * current rate — written to the sheet for people reading it there. Never an
   * input: it's recalculated on every row write and whenever the rate
   * changes, so editing it by hand has no effect. 0 when the item isn't priced.
   */
  price: number;
}
