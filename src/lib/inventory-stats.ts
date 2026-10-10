import { INVENTORY_CATEGORIES } from "@/lib/constants";
import { normalizeSku } from "@/lib/sku";
import type { InventoryCategory, InventoryItem } from "@/types/inventory";

/** Quantity 0 is out of stock; exactly 1 is low stock. */
export const LOW_STOCK_QUANTITY = 1;

export type StockLevel = "out" | "low" | "ok";

export function stockLevel(quantity: number): StockLevel {
  if (quantity <= 0) return "out";
  if (quantity <= LOW_STOCK_QUANTITY) return "low";
  return "ok";
}

/** Sums of decimal weights pick up float noise (2.18 × 3 = 6.540000000000001). */
export function roundGrams(grams: number): number {
  return Math.round(grams * 100) / 100;
}

interface Totals {
  skus: number;
  pieces: number;
  /** Weight × quantity, summed — the metal actually in stock. */
  grams: number;
  outOfStock: number;
  lowStock: number;
}

function totalsOf(items: InventoryItem[]): Totals {
  const totals: Totals = { skus: items.length, pieces: 0, grams: 0, outOfStock: 0, lowStock: 0 };
  for (const item of items) {
    totals.pieces += item.quantity;
    totals.grams += item.weightGrams * item.quantity;
    const level = stockLevel(item.quantity);
    if (level === "out") totals.outOfStock += 1;
    if (level === "low") totals.lowStock += 1;
  }
  totals.grams = roundGrams(totals.grams);
  return totals;
}

export interface CategoryStats extends Totals {
  category: InventoryCategory;
  label: string;
  /** Lightest and heaviest single piece — a quick way to spot a mistyped weight. */
  minWeight: number | null;
  maxWeight: number | null;
}

export interface SkuGroupStats extends Totals {
  /** The letters before the number, e.g. "RRA" for RRA001. "Other" for SKUs that don't follow the pattern. */
  prefix: string;
  categories: InventoryCategory[];
  /** First and last SKU in the numbered series, e.g. RRA001 and RRA024. */
  firstSku: string | null;
  lastSku: string | null;
  /** SKUs missing from the series between first and last. */
  gaps: string[];
}

export interface InventoryStats {
  totals: Totals & { notListed: number };
  categories: CategoryStats[];
  groups: SkuGroupStats[];
  outOfStock: InventoryItem[];
  lowStock: InventoryItem[];
  /** In Inventory, but no Studio product uses the SKU and the row has no Shopify product ID. */
  notListed: InventoryItem[];
}

/** "RRA001" → { prefix: "RRA", number: 1, digits: 3 }; null if the SKU isn't letters followed by digits. */
function parseSku(sku: string): { prefix: string; number: number; digits: number } | null {
  const match = normalizeSku(sku).match(/^([A-Z]+)[-_ ]?(\d+)$/);
  if (!match) return null;
  return { prefix: match[1], number: Number(match[2]), digits: match[2].length };
}

/** Caps how many gaps one group lists, so a typo like RRA9999 doesn't produce thousands. */
const MAX_GAPS = 50;

function groupStats(prefix: string, items: InventoryItem[]): SkuGroupStats {
  const numbered = items
    .map((item) => ({ item, parsed: parseSku(item.sku) }))
    .filter((entry): entry is { item: InventoryItem; parsed: NonNullable<ReturnType<typeof parseSku>> } =>
      Boolean(entry.parsed)
    )
    .sort((a, b) => a.parsed.number - b.parsed.number);

  const gaps: string[] = [];
  if (numbered.length > 1) {
    const present = new Set(numbered.map((entry) => entry.parsed.number));
    // Pad gaps like the series' first SKU (RRA007, not RRA7).
    const digits = numbered[0].parsed.digits;
    const first = numbered[0].parsed.number;
    const last = numbered[numbered.length - 1].parsed.number;
    for (let n = first + 1; n < last && gaps.length < MAX_GAPS; n++) {
      if (!present.has(n)) gaps.push(`${prefix}${String(n).padStart(digits, "0")}`);
    }
  }

  return {
    prefix,
    ...totalsOf(items),
    categories: [...new Set(items.map((item) => item.category))],
    firstSku: numbered[0]?.item.sku ?? null,
    lastSku: numbered[numbered.length - 1]?.item.sku ?? null,
    gaps,
  };
}

const bySku = (a: InventoryItem, b: InventoryItem) =>
  a.sku.localeCompare(b.sku, undefined, { numeric: true, sensitivity: "base" });

/** `listedSkus` — SKUs a Studio product was created from (ProductRecord.sku), in any spelling. */
export function computeInventoryStats(items: InventoryItem[], listedSkus: string[]): InventoryStats {
  const listed = new Set(listedSkus.filter(Boolean).map(normalizeSku));

  const categories = INVENTORY_CATEGORIES.map(({ value, label }) => {
    const inCategory = items.filter((item) => item.category === value);
    const weights = inCategory.map((item) => item.weightGrams);
    return {
      category: value,
      label,
      ...totalsOf(inCategory),
      minWeight: weights.length ? Math.min(...weights) : null,
      maxWeight: weights.length ? Math.max(...weights) : null,
    };
  });

  const byPrefix = new Map<string, InventoryItem[]>();
  for (const item of items) {
    const prefix = parseSku(item.sku)?.prefix ?? normalizeSku(item.sku).match(/^[A-Z]+/)?.[0] ?? "Other";
    byPrefix.set(prefix, [...(byPrefix.get(prefix) ?? []), item]);
  }
  const groups = [...byPrefix.entries()]
    .map(([prefix, groupItems]) => groupStats(prefix, groupItems))
    .sort((a, b) => a.prefix.localeCompare(b.prefix));

  const notListed = items
    .filter((item) => !item.shopifyProductId.trim() && !listed.has(normalizeSku(item.sku)))
    .sort(bySku);

  return {
    totals: { ...totalsOf(items), notListed: notListed.length },
    categories,
    groups,
    outOfStock: items.filter((item) => stockLevel(item.quantity) === "out").sort(bySku),
    lowStock: items.filter((item) => stockLevel(item.quantity) === "low").sort(bySku),
    notListed,
  };
}
