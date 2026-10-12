import { normalizeSku } from "@/lib/sku";
import type { InventoryCategory, InventoryItem } from "@/types/inventory";

/** A weight search shows pieces within this share of the typed weight. */
const WEIGHT_TOLERANCE = 0.15;

/** "3.2", "3.2g", "3.2 g" → 3.2; anything else → null (a SKU search). */
export function parseWeightQuery(query: string): number | null {
  const match = query.trim().toLowerCase().match(/^(\d+(?:\.\d+)?)\s*g?$/);
  return match ? Number(match[1]) : null;
}

const bySku = (a: InventoryItem, b: InventoryItem) =>
  a.sku.localeCompare(b.sku, undefined, { numeric: true, sensitivity: "base" });

/**
 * Search by SKU, or by weight: "3.2" lists the pieces within ±15% of 3.2 g,
 * closest first (staff often have the piece in hand and can weigh it). A
 * number also matches SKUs containing it, since RRA017 → "017".
 */
export function searchItems(items: InventoryItem[], query: string, category: InventoryCategory | "all" = "all"): InventoryItem[] {
  const inCategory = category === "all" ? items : items.filter((item) => item.category === category);
  const weight = parseWeightQuery(query);
  if (weight !== null && weight > 0) {
    const digits = query.trim();
    return inCategory
      .filter(
        (item) =>
          Math.abs(item.weightGrams - weight) <= weight * WEIGHT_TOLERANCE || normalizeSku(item.sku).includes(digits)
      )
      .sort((a, b) => Math.abs(a.weightGrams - weight) - Math.abs(b.weightGrams - weight));
  }
  const needle = normalizeSku(query);
  return inCategory.filter((item) => !needle || normalizeSku(item.sku).includes(needle)).sort(bySku);
}
