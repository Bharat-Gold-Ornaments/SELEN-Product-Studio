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
}
