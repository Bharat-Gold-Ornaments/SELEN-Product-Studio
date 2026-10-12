import { normalizeSku } from "@/lib/sku";
import type { InventoryCategory, InventoryItem } from "@/types/inventory";

/** "Add new design" asks "Is it one of these?" for pieces within this share of the weight entered. */
export const SIMILAR_WEIGHT_TOLERANCE = 0.05;

/** Same pair whichever order the SKUs come in. */
export function duplicatePairKey(skuA: string, skuB: string): string {
  return [normalizeSku(skuA), normalizeSku(skuB)].sort().join("|");
}

/** Pieces in the same category within ±5% of `weightGrams`, closest first. */
export function similarItems(items: InventoryItem[], category: InventoryCategory, weightGrams: number): InventoryItem[] {
  return items
    .filter((item) => item.category === category)
    .filter((item) => Math.abs(item.weightGrams - weightGrams) <= weightGrams * SIMILAR_WEIGHT_TOLERANCE)
    .sort((a, b) => Math.abs(a.weightGrams - weightGrams) - Math.abs(b.weightGrams - weightGrams));
}

export interface DuplicatePair {
  key: string;
  a: InventoryItem;
  b: InventoryItem;
  weightDifference: number;
}

/**
 * Pairs that may be the same design entered twice: same category and
 * near-identical weight (within 0.01 g, or 0.5% for heavier pieces). A
 * prompt to look at the photos, not a verdict — pairs marked "Not a
 * duplicate" are left out. Closest weights first.
 */
export function possibleDuplicatePairs(items: InventoryItem[], dismissed: Set<string>): DuplicatePair[] {
  const pairs: DuplicatePair[] = [];
  const sorted = [...items].sort((x, y) => x.weightGrams - y.weightGrams);
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const a = sorted[i];
      const b = sorted[j];
      const difference = b.weightGrams - a.weightGrams;
      // Looser than this flags most of a catalogue whose pieces weigh 2–5 g.
      const tolerance = Math.max(0.01, 0.005 * b.weightGrams) + 1e-9;
      if (difference > tolerance) break; // sorted by weight, so nothing further along is closer
      if (a.category !== b.category) continue;
      const key = duplicatePairKey(a.sku, b.sku);
      if (dismissed.has(key)) continue;
      pairs.push({ key, a, b, weightDifference: Math.round(difference * 1000) / 1000 });
    }
  }
  return pairs.sort((x, y) => x.weightDifference - y.weightDifference || x.key.localeCompare(y.key));
}
