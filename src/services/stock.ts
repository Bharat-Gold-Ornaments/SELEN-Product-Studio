import "server-only";
import { randomUUID } from "node:crypto";
import {
  adjustInventoryQuantities,
  appendStockLogEntries,
  deleteInventoryRow,
  listInventoryItems,
  listProducts,
  listStockLogEntries,
  updateInventoryRow,
  updateProductRow,
  updateStockLogEntries,
  type StockLogUpdate,
} from "@/services/google-sheets";
import {
  adjustShopifyStock,
  findShopifyVariantsBySku,
  getShopifyProductStockVariants,
  type ShopifyStockVariant,
} from "@/services/shopify";
import { normalizeSku, sameSku } from "@/lib/sku";
import { parseVariantRows, serializeVariantRows, totalVariantInventory } from "@/lib/variants";
import type { InventoryItem } from "@/types/inventory";
import type { ProductRecord } from "@/types/product";
import type { RecordSalesInput, RecordSalesResult, StockLogEntry, StockMovementType } from "@/types/stock-log";

/** Bad input from the caller — the route answers 400 (or 404/409) instead of 500. */
export class StockInputError extends Error {
  constructor(
    message: string,
    readonly status = 400
  ) {
    super(message);
    this.name = "StockInputError";
  }
}

/** A Stock Log row with every optional field blank. */
export function newStockLogEntry(
  fields: Pick<StockLogEntry, "date" | "type" | "sku" | "change" | "stockAfter"> & Partial<StockLogEntry>
): StockLogEntry {
  return {
    id: randomUUID(),
    recordedAt: new Date().toISOString(),
    recordedBy: "",
    note: "",
    shopifyStatus: "",
    shopifyOrderRef: "",
    reversesId: "",
    relatedSku: "",
    shopifyProductRef: "",
    shopifyVariantRef: "",
    ...fields,
  };
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function requireName(recordedBy: string, action: string): string {
  const name = recordedBy.trim();
  if (!name) throw new StockInputError(`Enter who is ${action}.`);
  return name;
}

// ── Finding a SKU on Shopify ────────────────────────────────────────────

type ShopifyTarget =
  | { kind: "found"; variant: ShopifyStockVariant }
  | { kind: "pending"; reason: string }
  | { kind: "not_on_shopify" };

/**
 * Which Shopify variant a SKU's stock lives on. Matched by the variant's SKU
 * first; failing that, by a Shopify product id the Sheet links to the SKU
 * (the Inventory row's own id, or a Studio product created from it) when
 * that product has a single variant. When the SKU is linked to a product
 * but the right variant can't be told apart, the result is `pending` — the
 * change is kept and sent once a SKU is added. With no link at all the item
 * counts as not on Shopify, and nothing is ever sent for it: a product
 * listed later starts from Inventory's stock at that time.
 */
async function resolveShopifyTarget(
  sku: string,
  inventory: InventoryItem[],
  products: ProductRecord[]
): Promise<ShopifyTarget> {
  const bySku = (await findShopifyVariantsBySku(sku)).filter((v) => v.sku && sameSku(v.sku, sku));
  if (bySku.length === 1) return { kind: "found", variant: bySku[0] };
  if (bySku.length > 1) {
    return { kind: "pending", reason: `SKU is on ${bySku.length} Shopify variants — keep it on one only.` };
  }

  const linkedIds = new Set(
    [
      ...inventory.filter((item) => sameSku(item.sku, sku)).map((item) => item.shopifyProductId),
      ...products.filter((p) => p.sku && sameSku(p.sku, sku)).map((p) => p.shopifyProductId ?? ""),
    ]
      .map((id) => id.trim())
      .filter(Boolean)
  );
  for (const id of linkedIds) {
    const variants = await getShopifyProductStockVariants(id);
    if (!variants) continue; // removed from Shopify
    if (variants.length === 1) return { kind: "found", variant: variants[0] };
    return {
      kind: "pending",
      reason: `Shopify product ${id} has ${variants.length} variants and none has this SKU — add it to the right one.`,
    };
  }
  return { kind: "not_on_shopify" };
}

/** An undo keeps its "Undo of …" note; other rows' notes only ever hold why they aren't on Shopify yet. */
function noteFor(entry: StockLogEntry, shopifyReason: string): string {
  return entry.reversesId ? entry.note : shopifyReason;
}

/**
 * Sends each entry's change to Shopify and returns the row updates. Never
 * throws: an entry that can't be sent stays `pending` with the reason in its
 * note. Entries go one at a time to stay under Shopify's rate limit. Also
 * returns the Shopify products whose stock changed.
 */
async function pushToShopify(
  entries: StockLogEntry[],
  inventory: InventoryItem[],
  products: ProductRecord[]
): Promise<{ updates: StockLogUpdate[]; changedProductIds: Set<string> }> {
  const updates: StockLogUpdate[] = [];
  const changedProductIds = new Set<string>();
  const targets = new Map<string, ShopifyTarget>();

  for (const entry of entries) {
    try {
      const key = normalizeSku(entry.sku);
      if (!targets.has(key)) targets.set(key, await resolveShopifyTarget(entry.sku, inventory, products));
      const target = targets.get(key)!;

      if (target.kind === "not_on_shopify") {
        updates.push({ id: entry.id, patch: { shopifyStatus: "not_on_shopify", note: noteFor(entry, "") } });
      } else if (target.kind === "pending") {
        updates.push({ id: entry.id, patch: { shopifyStatus: "pending", note: noteFor(entry, target.reason) } });
      } else {
        await adjustShopifyStock({
          inventoryItemId: target.variant.inventoryItemId,
          delta: entry.change,
          stockLogId: entry.id,
        });
        changedProductIds.add(target.variant.shopifyProductId);
        updates.push({ id: entry.id, patch: { shopifyStatus: "sent", note: noteFor(entry, "") } });
      }
    } catch (error) {
      console.error(`Couldn't send stock change ${entry.id} (${entry.sku}) to Shopify`, error);
      const message = error instanceof Error ? error.message : "Unknown error";
      updates.push({
        id: entry.id,
        patch: { shopifyStatus: "pending", note: noteFor(entry, `Couldn't reach Shopify: ${message}`) },
      });
    }
  }
  return { updates, changedProductIds };
}

/**
 * Copies Shopify's current stock into the Products tab rows of the given
 * Shopify products — per variant (matched by Color/Size) when the product
 * has variants, as the plain inventory number otherwise — so the Products
 * tab follows the change too. Best-effort: Reconciliation flags any gap.
 */
export async function refreshProductsTabStock(shopifyProductIds: Set<string>, products?: ProductRecord[]): Promise<void> {
  if (shopifyProductIds.size === 0) return;
  const records = products ?? (await listProducts());
  for (const id of shopifyProductIds) {
    try {
      const record = records.find((p) => p.shopifyProductId?.trim() === id);
      if (!record) continue;
      const variants = await getShopifyProductStockVariants(id);
      if (!variants) continue;

      const rows = parseVariantRows(record.variants);
      if (rows.length > 0) {
        const key = (color: string, size: string) => `${color.trim().toLowerCase()}::${size.trim().toLowerCase()}`;
        const quantityByKey = new Map(variants.map((v) => [key(v.color, v.size), v.quantity]));
        const updated = rows.map((row) => ({ ...row, inventory: quantityByKey.get(key(row.color, row.size)) ?? row.inventory }));
        await updateProductRow(record.productId, {
          variants: serializeVariantRows(updated),
          inventory: totalVariantInventory(updated),
        });
      } else {
        await updateProductRow(record.productId, {
          inventory: variants.reduce((sum, v) => sum + v.quantity, 0),
          inventorySyncStatus: "synced",
          inventorySyncedAt: new Date().toISOString(),
        });
      }
    } catch (error) {
      console.error(`Couldn't refresh Products tab stock for Shopify product ${id}`, error);
    }
  }
}

/** Saves the push results to the sheet and returns the entries as saved. */
async function saveUpdates(entries: StockLogEntry[], updates: StockLogUpdate[]): Promise<StockLogEntry[]> {
  try {
    await updateStockLogEntries(updates);
  } catch (error) {
    // The changes did reach Shopify; the rows just still say pending. A retry
    // re-sends them with the same idempotency key, which Shopify ignores.
    console.error("Couldn't save Shopify statuses to the Stock Log", error);
    return entries;
  }
  const byId = new Map(updates.map((u) => [u.id, u.patch]));
  return entries.map((entry) => ({ ...entry, ...byId.get(entry.id) }));
}

// ── Applying a change ───────────────────────────────────────────────────

interface StockChange {
  type: Extract<StockMovementType, "sale" | "restock">;
  date: string;
  recordedBy: string;
  /** Signed deltas, at most one line per SKU. */
  lines: { sku: string; delta: number }[];
}

/**
 * The one path for a change that physically moves stock. Order matters for
 * failure handling:
 * 1. the Inventory tab quantities change (one write);
 * 2. one Stock Log row per SKU is written, marked pending;
 * 3. each change is sent to Shopify as a delta, and the rows are updated.
 * If 3 fails partway, the rows stay pending and "Retry" on the Sales page
 * sends them later — never twice, since each row's id is its idempotency key.
 */
async function applyStockChange(change: StockChange): Promise<StockLogEntry[]> {
  const [inventory, products] = await Promise.all([listInventoryItems(), listProducts()]);
  for (const { sku } of change.lines) {
    if (!inventory.some((item) => sameSku(item.sku, sku))) {
      throw new StockInputError(`SKU ${sku} isn't in Inventory.`, 404);
    }
  }

  const applied = await adjustInventoryQuantities(change.lines);
  let entries = applied.map((result, i) =>
    newStockLogEntry({
      date: change.date,
      type: change.type,
      sku: result.sku,
      change: change.lines[i].delta,
      stockAfter: result.after,
      recordedBy: change.recordedBy,
      shopifyStatus: "pending",
    })
  );
  await appendStockLogEntries(entries);

  const { updates, changedProductIds } = await pushToShopify(entries, inventory, products);
  entries = await saveUpdates(entries, updates);
  await refreshProductsTabStock(changedProductIds, products);
  return entries;
}

/** Records a day's offline sales — stock comes off Inventory and Shopify. */
export async function recordSales(input: RecordSalesInput): Promise<RecordSalesResult> {
  if (!DATE_PATTERN.test(input.date)) throw new StockInputError("Pick the date these sales belong to.");
  const recordedBy = requireName(input.recordedBy, "recording these sales");

  const quantities = new Map<string, { sku: string; quantity: number }>();
  for (const line of input.lines) {
    if (!line.sku?.trim()) throw new StockInputError("Every line needs a SKU.");
    if (!Number.isInteger(line.quantity) || line.quantity < 1) {
      throw new StockInputError(`Quantity for ${line.sku} must be a whole number of 1 or more.`);
    }
    const key = normalizeSku(line.sku);
    const existing = quantities.get(key);
    quantities.set(key, { sku: line.sku.trim(), quantity: (existing?.quantity ?? 0) + line.quantity });
  }
  if (quantities.size === 0) throw new StockInputError("Add at least one item.");

  const entries = await applyStockChange({
    type: "sale",
    date: input.date,
    recordedBy,
    lines: [...quantities.values()].map((l) => ({ sku: l.sku, delta: -l.quantity })),
  });
  return { entries };
}

/** New pieces of a design already in Inventory: stock goes up on Inventory and Shopify. */
export async function restockItem(sku: string, quantity: number, recordedBy: string, date: string): Promise<StockLogEntry> {
  if (!sku.trim()) throw new StockInputError("Pick the item that arrived.");
  if (!Number.isInteger(quantity) || quantity < 1) throw new StockInputError("Quantity must be a whole number of 1 or more.");
  if (!DATE_PATTERN.test(date)) throw new StockInputError("Pick the date the stock arrived.");
  const name = requireName(recordedBy, "adding this stock");

  const [entry] = await applyStockChange({ type: "restock", date, recordedBy: name, lines: [{ sku: sku.trim(), delta: quantity }] });
  return entry;
}

/**
 * Reverses a recorded shop sale: the stock goes back up and a `correction`
 * row pointing at the sale is added — nothing is deleted. On Shopify it
 * follows the sale: sent again if the sale was sent; left pending if the
 * sale is still pending (both are sent together later and cancel out);
 * never sent if the item isn't on Shopify. Online sales are reversed by
 * cancelling or refunding the order on Shopify instead.
 */
export async function undoSale(id: string, recordedBy: string): Promise<StockLogEntry> {
  const who = requireName(recordedBy, "undoing this sale");

  const log = await listStockLogEntries();
  const sale = log.find((entry) => entry.id === id);
  if (!sale || sale.type !== "sale") throw new StockInputError("That sale wasn't found.", 404);
  if (log.some((entry) => entry.reversesId === id)) throw new StockInputError("That sale was already undone.", 409);

  const [inventory, products] = await Promise.all([listInventoryItems(), listProducts()]);
  const [applied] = await adjustInventoryQuantities([{ sku: sale.sku, delta: -sale.change }]);

  let entry = newStockLogEntry({
    date: sale.date,
    type: "correction",
    sku: applied.sku,
    change: -sale.change,
    stockAfter: applied.after,
    recordedBy: who,
    note: `Undo of sale recorded by ${sale.recordedBy || "unknown"}`,
    shopifyStatus: sale.shopifyStatus === "sent" ? "pending" : sale.shopifyStatus,
    reversesId: sale.id,
  });
  await appendStockLogEntries([entry]);

  if (sale.shopifyStatus === "sent") {
    const { updates, changedProductIds } = await pushToShopify([entry], inventory, products);
    [entry] = await saveUpdates([entry], updates);
    await refreshProductsTabStock(changedProductIds, products);
  }
  return entry;
}

/** Re-sends every pending Stock Log entry to Shopify. Returns how many went through and how many are still pending. */
export async function retryPendingShopifyChanges(): Promise<{ sent: number; stillPending: number }> {
  const pending = (await listStockLogEntries()).filter((entry) => entry.shopifyStatus === "pending");
  if (pending.length === 0) return { sent: 0, stillPending: 0 };

  const [inventory, products] = await Promise.all([listInventoryItems(), listProducts()]);
  const { updates, changedProductIds } = await pushToShopify(pending, inventory, products);
  await updateStockLogEntries(updates);
  await refreshProductsTabStock(changedProductIds, products);
  return {
    sent: updates.filter((u) => u.patch.shopifyStatus === "sent").length,
    stillPending: updates.filter((u) => u.patch.shopifyStatus === "pending").length,
  };
}

/**
 * Logs a stock change made on the Inventory page (a new item, or a quantity
 * edited by hand). Those edits don't touch Shopify, so the row's Shopify
 * status is left blank. Best-effort: the edit itself already succeeded.
 */
export async function logInventoryPageChange(
  type: "new" | "correction",
  sku: string,
  change: number,
  stockAfter: number
): Promise<void> {
  try {
    await appendStockLogEntries([
      newStockLogEntry({
        date: new Date().toISOString().slice(0, 10),
        type,
        sku,
        change,
        stockAfter,
        note: type === "new" ? "Added on the Inventory page" : "Quantity edited on the Inventory page",
      }),
    ]);
  } catch (error) {
    console.error(`Couldn't log the Inventory page change for ${sku}`, error);
  }
}

// ── Merging duplicates ──────────────────────────────────────────────────

export interface MergeResult {
  item: InventoryItem;
  /** Things left for a person to fix on Shopify — the app never edits listings during a merge. */
  warnings: string[];
}

/**
 * Combines two Inventory rows for the same design into `keepSku`: the
 * quantities are added, the kept row takes the other's photo and Shopify id
 * if it has none, Studio products created from the removed SKU are relinked,
 * and the removed row is deleted. Shopify stock isn't touched — the pieces
 * didn't move — but if the removed SKU is still on a Shopify listing, that's
 * returned as a warning to fix by hand.
 */
export async function mergeInventoryItems(keepSku: string, removeSku: string, recordedBy: string): Promise<MergeResult> {
  const who = requireName(recordedBy, "merging these items");
  if (sameSku(keepSku, removeSku)) throw new StockInputError("Pick two different SKUs.");

  const [inventory, products] = await Promise.all([listInventoryItems(), listProducts()]);
  const keep = inventory.find((item) => sameSku(item.sku, keepSku));
  const remove = inventory.find((item) => sameSku(item.sku, removeSku));
  if (!keep || !remove) throw new StockInputError("One of those SKUs is no longer in Inventory.", 404);

  const [applied] = await adjustInventoryQuantities([{ sku: keep.sku, delta: remove.quantity }]);
  const { item } = await updateInventoryRow(keep.sku, {
    photoUrl: keep.photoUrl || remove.photoUrl,
    shopifyProductId: keep.shopifyProductId || remove.shopifyProductId,
  });
  await deleteInventoryRow(remove.sku);

  for (const product of products.filter((p) => p.sku && sameSku(p.sku, remove.sku))) {
    await updateProductRow(product.productId, { sku: keep.sku });
  }

  const date = new Date().toISOString().slice(0, 10);
  await appendStockLogEntries([
    newStockLogEntry({
      date,
      type: "merge",
      sku: remove.sku,
      change: -remove.quantity,
      stockAfter: 0,
      recordedBy: who,
      note: `Merged into ${keep.sku}`,
      relatedSku: keep.sku,
    }),
    newStockLogEntry({
      date,
      type: "merge",
      sku: keep.sku,
      change: remove.quantity,
      stockAfter: applied.after,
      recordedBy: who,
      note: `Merged from ${remove.sku}`,
      relatedSku: remove.sku,
    }),
  ]);

  const warnings: string[] = [];
  try {
    const stillOnShopify = (await findShopifyVariantsBySku(remove.sku)).filter((v) => sameSku(v.sku, remove.sku));
    for (const variant of stillOnShopify) {
      warnings.push(
        `${remove.sku} is still the SKU of a variant of Shopify product ${variant.shopifyProductId}. ` +
          `Change it to ${keep.sku} in Shopify admin, or archive that listing if it's a duplicate.`
      );
    }
  } catch (error) {
    console.error(`Couldn't check Shopify for ${remove.sku} after merging`, error);
  }
  return { item: { ...item, quantity: applied.after }, warnings };
}
