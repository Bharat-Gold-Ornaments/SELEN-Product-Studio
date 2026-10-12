import "server-only";
import {
  adjustInventoryQuantities,
  appendStockLogEntries,
  listInventoryItems,
  listProducts,
  listStockLogEntries,
  type InventoryQuantityChange,
} from "@/services/google-sheets";
import { readConfigFile, writeConfigFile } from "@/services/google-drive";
import { listShopifyOrdersForStock, shopifyAdminProductUrl, type ShopifyOrderLine } from "@/services/shopify";
import {
  StockInputError,
  newStockLogEntry,
  refreshProductsTabStock,
  retryPendingShopifyChanges,
} from "@/services/stock";
import { normalizeSku, sameSku } from "@/lib/sku";
import type { InventoryItem } from "@/types/inventory";
import type { ProductRecord } from "@/types/product";
import type { OnlineSyncState, WaitingOnlineSale } from "@/types/online-orders";
import type { StockLogEntry } from "@/types/stock-log";

// Takes Shopify's online sales off the Inventory tab. Shopify already took
// them off its own stock, so nothing is sent back. Orders from before the
// first sync are ignored: Inventory was counted by hand and already
// reflects them. Each order line is applied once (its id is kept on the
// Stock Log row); a later refund or cancellation that Shopify restocked
// puts the pieces back with a correction row.

const STATE_FILE = "online-orders-sync.json";
/** Without read_all_orders Shopify only returns this much history anyway. */
const LOOKBACK_DAYS = 60;

async function readState(): Promise<OnlineSyncState | null> {
  const raw = await readConfigFile(STATE_FILE);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<OnlineSyncState>;
    if (!parsed.trackingSince) return null;
    return {
      trackingSince: parsed.trackingSince,
      lastSyncedAt: parsed.lastSyncedAt ?? "",
      waiting: Array.isArray(parsed.waiting) ? parsed.waiting : [],
    };
  } catch {
    return null;
  }
}

async function writeState(state: OnlineSyncState): Promise<void> {
  await writeConfigFile(STATE_FILE, JSON.stringify(state, null, 2));
}

/** What the last sync found, without calling Shopify. Null before the first sync. */
export async function getOnlineSyncState(): Promise<OnlineSyncState | null> {
  return readState();
}

/** YYYY-MM-DD of `iso` in the shop's time zone — the day an order counts towards. */
function dayIn(timeZone: string, iso: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(
      new Date(iso)
    );
  } catch {
    return iso.slice(0, 10);
  }
}

type LineMatch = { sku: string } | { reason: string };

/**
 * The Inventory SKU an order line sold: by the variant's SKU (current, then
 * as ordered), or else by an Inventory row or Studio product linked to the
 * line's Shopify product when that product has a single variant.
 */
function matchLine(line: ShopifyOrderLine, inventory: InventoryItem[], products: ProductRecord[]): LineMatch {
  for (const sku of [line.currentSku, line.sku]) {
    const item = sku.trim() ? inventory.find((i) => sameSku(i.sku, sku)) : undefined;
    if (item) return { sku: item.sku };
  }
  if (!line.shopifyProductId) return { reason: "The product was deleted from Shopify." };

  const id = line.shopifyProductId;
  const linked = new Set(
    [
      ...inventory.filter((i) => i.shopifyProductId.trim() === id).map((i) => i.sku),
      ...products.filter((p) => p.shopifyProductId?.trim() === id && p.sku).map((p) => p.sku),
    ]
      .filter((sku) => inventory.some((i) => sameSku(i.sku, sku)))
      .map(normalizeSku)
  );
  if (line.productVariantCount === 1 && linked.size === 1) {
    const sku = [...linked][0];
    return { sku: inventory.find((i) => normalizeSku(i.sku) === sku)!.sku };
  }
  if (line.productVariantCount > 1) {
    return { reason: "This variant has no SKU on Shopify. Add its Inventory SKU there." };
  }
  if (line.currentSku.trim()) {
    return { reason: `SKU ${line.currentSku} on Shopify isn't in Inventory.` };
  }
  return { reason: "No SKU on Shopify. Add its Inventory SKU there." };
}

/** Where a merged-away SKU's stock lives now. */
function resolveMerged(sku: string, log: StockLogEntry[], inventory: InventoryItem[]): string | null {
  let current = sku;
  for (let hops = 0; hops < 10; hops++) {
    const item = inventory.find((i) => sameSku(i.sku, current));
    if (item) return item.sku;
    const merge = log.find((e) => e.type === "merge" && e.change <= 0 && e.relatedSku && sameSku(e.sku, current));
    if (!merge) return null;
    current = merge.relatedSku;
  }
  return null;
}

export interface OnlineSyncResult extends OnlineSyncState {
  /** True when this sync only started tracking — nothing before it is imported. */
  firstRun: boolean;
  imported: number;
  returned: number;
  /** Offline sales that reached Shopify during this sync's catch-up. */
  shopifySent: number;
}

let running: Promise<OnlineSyncResult> | null = null;

/**
 * Imports new online sales and Shopify restocks into the Inventory tab, then
 * retries any offline sales still waiting to reach Shopify — so adding a
 * missing SKU on Shopify settles both directions on the next sync. Only one
 * sync runs at a time per server, so two open pages can't import an order
 * twice.
 */
export function syncOnlineOrders(): Promise<OnlineSyncResult> {
  running ??= runSync().finally(() => {
    running = null;
  });
  return running;
}

async function runSync(): Promise<OnlineSyncResult> {
  const now = new Date().toISOString();
  const state = await readState();
  if (!state) {
    const started: OnlineSyncState = { trackingSince: now, lastSyncedAt: now, waiting: [] };
    await writeState(started);
    return { ...started, firstRun: true, imported: 0, returned: 0, shopifySent: 0 };
  }

  const lookback = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const since = state.trackingSince > lookback ? state.trackingSince : lookback;

  let shopify: Awaited<ReturnType<typeof listShopifyOrdersForStock>>;
  try {
    shopify = await listShopifyOrdersForStock(since);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/access denied/i.test(message)) {
      throw new StockInputError(
        "Shopify hasn't allowed this app to read orders yet. Add the read_orders access scope to the app in Shopify, then sync again.",
        403
      );
    }
    throw error;
  }

  const [inventory, products, log] = await Promise.all([listInventoryItems(), listProducts(), listStockLogEntries()]);
  const importedByLine = new Map(log.filter((e) => e.type === "online_sale" && e.shopifyOrderRef).map((e) => [e.shopifyOrderRef, e]));
  const reversedQuantity = (id: string) =>
    log.filter((e) => e.reversesId === id).reduce((sum, e) => sum + e.change, 0);

  const today = dayIn(shopify.timeZone, now);
  const waiting: WaitingOnlineSale[] = [];
  const changes: InventoryQuantityChange[] = [];
  const drafts: StockLogEntry[] = [];

  for (const order of shopify.orders) {
    for (const line of order.lines) {
      const imported = importedByLine.get(line.id);

      if (!imported) {
        const net = line.quantity - line.restockedQuantity;
        if (net <= 0) continue; // cancelled and restocked before it was ever imported
        const match = matchLine(line, inventory, products);
        if ("reason" in match) {
          waiting.push({
            lineId: line.id,
            orderName: order.name,
            orderDate: dayIn(shopify.timeZone, order.createdAt),
            productTitle: line.productTitle,
            lineName: line.name,
            quantity: net,
            shopifyAdminUrl: line.shopifyProductId ? shopifyAdminProductUrl(line.shopifyProductId) : null,
            reason: match.reason,
          });
          continue;
        }
        changes.push({ sku: match.sku, delta: -net });
        drafts.push(
          newStockLogEntry({
            date: dayIn(shopify.timeZone, order.createdAt),
            type: "online_sale",
            sku: match.sku,
            change: -net,
            stockAfter: 0, // filled in below
            recordedBy: "Shopify",
            note: `Order ${order.name}`,
            shopifyOrderRef: line.id,
            shopifyProductRef: line.shopifyProductId ?? "",
            shopifyVariantRef: line.variantId ?? "",
          })
        );
        continue;
      }

      // Already imported: put back anything Shopify restocked since.
      const sold = -imported.change;
      const due = Math.min(line.restockedQuantity, sold) - reversedQuantity(imported.id);
      if (due <= 0) continue;
      const sku = resolveMerged(imported.sku, log, inventory);
      if (!sku) {
        console.warn(`Order ${order.name}: ${imported.sku} is no longer in Inventory, so its return wasn't applied.`);
        continue;
      }
      changes.push({ sku, delta: due });
      drafts.push(
        newStockLogEntry({
          date: today,
          type: "correction",
          sku,
          change: due,
          stockAfter: 0,
          recordedBy: "Shopify",
          note: `Returned or cancelled on Shopify (${imported.note || "online order"})`,
          reversesId: imported.id,
          shopifyOrderRef: line.id,
          shopifyProductRef: line.shopifyProductId ?? "",
          shopifyVariantRef: line.variantId ?? "",
        })
      );
    }
  }

  if (changes.length > 0) {
    const applied = await adjustInventoryQuantities(changes);
    const entries = drafts.map((draft, i) => ({ ...draft, sku: applied[i].sku, stockAfter: applied[i].after }));
    await appendStockLogEntries(entries);
    await refreshProductsTabStock(new Set(entries.map((e) => e.shopifyProductRef).filter(Boolean)), products);
  }

  let shopifySent = 0;
  try {
    shopifySent = (await retryPendingShopifyChanges()).sent;
  } catch (error) {
    console.error("Couldn't retry pending Shopify stock changes during the order sync", error);
  }

  const next: OnlineSyncState = { trackingSince: state.trackingSince, lastSyncedAt: now, waiting };
  await writeState(next);
  return {
    ...next,
    firstRun: false,
    imported: drafts.filter((d) => d.type === "online_sale").length,
    returned: drafts.filter((d) => d.type === "correction").length,
    shopifySent,
  };
}
