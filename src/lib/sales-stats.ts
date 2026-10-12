import { INVENTORY_CATEGORIES } from "@/lib/constants";
import { normalizeSku } from "@/lib/sku";
import type { InventoryCategory, InventoryItem } from "@/types/inventory";
import type { StockLogEntry } from "@/types/stock-log";

/** YYYY-MM-DD in the viewer's own time zone — the business day staff mean by "today". */
export function localDate(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return localDate(new Date(y, m - 1, d + days));
}

export function isSale(entry: StockLogEntry): boolean {
  return entry.type === "sale" || entry.type === "online_sale";
}

/**
 * Sales that still count, shop and online, with the pieces each still
 * counts for: a shop sale undone, or an online order fully returned, drops
 * out; a partial return lowers the quantity.
 */
export function activeSales(entries: StockLogEntry[]): StockLogEntry[] {
  const reversed = new Map<string, number>();
  for (const e of entries) if (e.reversesId) reversed.set(e.reversesId, (reversed.get(e.reversesId) ?? 0) + e.change);
  return entries
    .filter(isSale)
    .map((e) => ({ ...e, change: e.change + (reversed.get(e.id) ?? 0) }))
    .filter((e) => e.change < 0);
}

/**
 * Normalized SKU → the SKU it was merged into, following chains, so a merged
 * SKU's past sales count towards the one that was kept.
 */
export function mergedSkuResolver(entries: StockLogEntry[]): (sku: string) => string {
  const into = new Map<string, string>();
  for (const e of entries) {
    if (e.type === "merge" && e.change <= 0 && e.relatedSku) into.set(normalizeSku(e.sku), normalizeSku(e.relatedSku));
  }
  return (sku) => {
    let key = normalizeSku(sku);
    for (let hops = 0; hops < 10 && into.has(key); hops++) key = into.get(key)!;
    return key;
  };
}

export interface SoldItem {
  sku: string;
  quantity: number;
  item: InventoryItem | undefined;
}

export interface SalesStats {
  pieces: number;
  /** Of `pieces`, sold online (imported from Shopify orders). */
  online: number;
  /** Distinct SKUs sold. */
  skus: number;
  /** Days in the range with at least one sale. */
  days: number;
  topItems: SoldItem[];
  byCategory: { category: InventoryCategory; label: string; quantity: number }[];
  /** Pieces per day, every day of the range including zeros, oldest first. */
  byDay: { date: string; pieces: number }[];
}

/** Sales between `from` and `to`, both inclusive (YYYY-MM-DD). */
export function computeSalesStats(
  entries: StockLogEntry[],
  inventory: InventoryItem[],
  from: string,
  to: string
): SalesStats {
  const sales = activeSales(entries).filter((e) => e.date >= from && e.date <= to);
  const resolve = mergedSkuResolver(entries);
  const itemBySku = new Map(inventory.map((item) => [normalizeSku(item.sku), item]));

  const bySku = new Map<string, SoldItem>();
  const perDay = new Map<string, number>();
  let online = 0;
  for (const sale of sales) {
    const key = resolve(sale.sku);
    const quantity = -sale.change;
    if (sale.type === "online_sale") online += quantity;
    const existing = bySku.get(key);
    bySku.set(key, { sku: existing?.sku ?? itemBySku.get(key)?.sku ?? sale.sku, quantity: (existing?.quantity ?? 0) + quantity, item: itemBySku.get(key) });
    perDay.set(sale.date, (perDay.get(sale.date) ?? 0) + quantity);
  }

  const topItems = [...bySku.values()].sort((a, b) => b.quantity - a.quantity || a.sku.localeCompare(b.sku));
  const byCategory = INVENTORY_CATEGORIES.map(({ value, label }) => ({
    category: value,
    label,
    quantity: topItems.filter((s) => s.item?.category === value).reduce((sum, s) => sum + s.quantity, 0),
  }));

  const byDay: { date: string; pieces: number }[] = [];
  for (let date = from; date <= to && byDay.length < 366; date = addDays(date, 1)) {
    byDay.push({ date, pieces: perDay.get(date) ?? 0 });
  }

  return {
    pieces: topItems.reduce((sum, s) => sum + s.quantity, 0),
    online,
    skus: topItems.length,
    days: perDay.size,
    topItems,
    byCategory,
    byDay,
  };
}

/**
 * In stock, in Inventory for at least `days`, and not sold in the last
 * `days`. Only as good as the sales history: before sales were recorded
 * here, everything looks unsold.
 */
export function slowMovers(entries: StockLogEntry[], inventory: InventoryItem[], days: number, today: string): InventoryItem[] {
  const since = addDays(today, -days);
  const resolve = mergedSkuResolver(entries);
  const recentlySold = new Set(activeSales(entries).filter((e) => e.date > since).map((e) => resolve(e.sku)));
  return inventory
    .filter((item) => item.quantity > 0)
    .filter((item) => !item.createdDate || item.createdDate.slice(0, 10) <= since)
    .filter((item) => !recentlySold.has(normalizeSku(item.sku)))
    .sort((a, b) => a.sku.localeCompare(b.sku, undefined, { numeric: true }));
}

/** "2026-10-11" → "Sat, 11 Oct 2026", read as a local day (new Date("2026-10-11") would be UTC midnight). */
export function formatDay(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) return date;
  return new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" }).format(
    new Date(y, m - 1, d)
  );
}

export interface SkuSalesTotal {
  sold: number;
  /** YYYY-MM-DD of the most recent sale. */
  lastSold: string;
}

/** All-time pieces sold and last sale date per SKU (normalized), undone sales left out. */
export function salesTotalsBySku(entries: StockLogEntry[]): Map<string, SkuSalesTotal> {
  const totals = new Map<string, SkuSalesTotal>();
  const resolve = mergedSkuResolver(entries);
  for (const sale of activeSales(entries)) {
    const key = resolve(sale.sku);
    const current = totals.get(key) ?? { sold: 0, lastSold: "" };
    totals.set(key, {
      sold: current.sold - sale.change,
      lastSold: sale.date > current.lastSold ? sale.date : current.lastSold,
    });
  }
  return totals;
}
