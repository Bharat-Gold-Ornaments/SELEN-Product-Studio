import "server-only";
import {
  appendInventoryRow,
  appendStockLogEntries,
  findProduct,
  listInventoryItems,
  listProducts,
  updateInventoryRow,
  updateProductRow,
  type InventoryUpdate,
} from "@/services/google-sheets";
import {
  getShopifyProductStockVariants,
  setShopifyVariantSku,
  setShopifyVariantStock,
  type ShopifyStockVariant,
} from "@/services/shopify";
import { readAppSettings } from "@/services/app-settings";
import { applyInventoryPricingToProducts } from "@/services/inventory-pricing";
import { applyInventoryToVariantRows } from "@/services/variants";
import { newStockLogEntry, StockInputError } from "@/services/stock";
import { hasPricing, inventoryPrice, pricingFields, pricingFromProduct } from "@/lib/inventory-pricing";
import { describeSkuUse, skuUsedElsewhere, skuUses, variantLabel } from "@/lib/product-skus";
import { normalizeSku, sameSku } from "@/lib/sku";
import { INVENTORY_CATEGORIES } from "@/lib/constants";
import {
  findVariantColorImageSet,
  parseVariantColorImages,
  parseVariantRows,
  resolveVariantPrice,
  serializeVariantRows,
  type VariantRow,
} from "@/lib/variants";
import { parseStoneLineItems } from "@/lib/pricing";
import type { InventoryItem } from "@/types/inventory";
import type { ProductRecord } from "@/types/product";
import type {
  LinkingOverview,
  LinkProduct,
  LinkProductInput,
  LinkProductResult,
  LinkSlot,
} from "@/types/product-linking";

// Links existing products, and each of their variants, to the Inventory SKU
// of the physical piece they sell — for products made before every product
// had to start from an Inventory SKU. Nothing is linked without a person
// confirming it on the Inventory page's Linking tab.

const optionKey = (color: string, size: string) => `${color.trim().toLowerCase()}::${size.trim().toLowerCase()}`;

/** "Rose Gold" → "RG", "Silver" → "SI": a short code for a new variant SKU. */
function colorCode(color: string): string {
  const words = color.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return words.map((w) => w[0]).join("").toUpperCase();
}

/** The variant that shows the product's own photos — the piece the product was first made from. */
function defaultRow(record: ProductRecord, rows: VariantRow[]): VariantRow | undefined {
  return (
    rows.find((row) => row.useDefaultImages) ??
    rows.find((row) => row.color.trim().toLowerCase() === record.finish.trim().toLowerCase()) ??
    rows[0]
  );
}

interface SlotSource {
  key: string;
  row: VariantRow | undefined;
  label: string;
  color: string;
  size: string;
  currentSku: string;
  /** The gross weight the product prices this piece on. */
  studioGrossWeight: number;
  studioQuantity: number;
  shopify: ShopifyStockVariant | undefined;
}

function slotSources(record: ProductRecord, shopifyVariants: ShopifyStockVariant[] | null): SlotSource[] {
  const rows = parseVariantRows(record.variants);
  if (rows.length === 0) {
    return [
      {
        key: "main",
        row: undefined,
        label: "Default",
        color: "",
        size: "",
        currentSku: record.sku ?? "",
        studioGrossWeight: record.weightGrams,
        studioQuantity: record.inventory,
        shopify: shopifyVariants?.length === 1 ? shopifyVariants[0] : undefined,
      },
    ];
  }
  return rows.map((row) => ({
    key: row.id,
    row,
    label: variantLabel(row),
    color: row.color,
    size: row.size,
    currentSku: row.sku,
    studioGrossWeight: !row.sameAsMainPrice && row.grossWeightGrams > 0 ? row.grossWeightGrams : record.weightGrams,
    studioQuantity: row.inventory,
    shopify: shopifyVariants?.find((v) => optionKey(v.color, v.size) === optionKey(row.color, row.size)),
  }));
}

function slotPhoto(record: ProductRecord, row: VariantRow | undefined): string {
  const own = row && !row.useDefaultImages
    ? findVariantColorImageSet(parseVariantColorImages(record.variantColorImages), row.color)?.images[0]?.url
    : undefined;
  return own || record.heroImageLink || record.closeupImageLink || record.lifestyleImageLink || "";
}

async function shopifyVariantsOf(record: ProductRecord): Promise<ShopifyStockVariant[] | null> {
  const id = record.shopifyProductId?.trim();
  if (!id) return null;
  try {
    return await getShopifyProductStockVariants(id);
  } catch (error) {
    console.error(`Couldn't read Shopify variants of product ${id}`, error);
    return null;
  }
}

/**
 * Every product with one slot per piece it sells, what each is linked to
 * now, and a suggested Inventory SKU where there's good evidence for one:
 * the SKU Shopify already has on that variant, or — for the product's
 * default piece — the one Inventory row that names this product's Shopify ID.
 */
export async function getLinkingOverview(): Promise<LinkingOverview> {
  const [products, inventory] = await Promise.all([listProducts(), listInventoryItems()]);
  const uses = skuUses(products);
  const claimed = new Set<string>(); // suggestions already handed to a slot
  const free = (sku: string, productId: string) =>
    !claimed.has(normalizeSku(sku)) && !skuUsedElsewhere(uses, sku, productId) && !uses.get(normalizeSku(sku))?.length;

  const result: LinkProduct[] = [];
  for (const record of products) {
    const sources = slotSources(record, await shopifyVariantsOf(record));
    const rows = parseVariantRows(record.variants);
    const defaultKey = rows.length ? defaultRow(record, rows)?.id : "main";

    const slots: LinkSlot[] = sources.map((source) => ({
      key: source.key,
      label: source.label,
      color: source.color,
      size: source.size,
      currentSku: source.currentSku,
      suggestedSku: "",
      suggestionReason: "",
      newSkuSuggestion: "",
      studioGrossWeight: source.studioGrossWeight,
      studioQuantity: source.studioQuantity,
      shopifyQuantity: source.shopify ? source.shopify.quantity : null,
      shopifySku: source.shopify?.sku ?? "",
      photoUrl: slotPhoto(record, source.row),
    }));

    // 1. Shopify already has an Inventory SKU on the variant.
    for (const slot of slots) {
      if (slot.currentSku || !slot.shopifySku) continue;
      const item = inventory.find((i) => sameSku(i.sku, slot.shopifySku));
      if (item && free(item.sku, record.productId)) {
        slot.suggestedSku = item.sku;
        slot.suggestionReason = "Shopify already has this SKU on the variant.";
        claimed.add(normalizeSku(item.sku));
      }
    }
    // 2. The one Inventory row that names this product's Shopify ID is its default piece.
    const id = record.shopifyProductId?.trim();
    const pointing = id ? inventory.filter((i) => i.shopifyProductId.trim() === id && free(i.sku, record.productId)) : [];
    const defaultSlot = slots.find((slot) => slot.key === defaultKey);
    if (pointing.length === 1 && defaultSlot && !defaultSlot.currentSku && !defaultSlot.suggestedSku) {
      defaultSlot.suggestedSku = pointing[0].sku;
      defaultSlot.suggestionReason = "This Inventory row has the product's Shopify ID.";
      claimed.add(normalizeSku(pointing[0].sku));
    }

    // A name for pieces not in Inventory: the default piece's SKU plus colour/size codes.
    const base =
      defaultSlot?.currentSku ||
      defaultSlot?.suggestedSku ||
      slots.find((slot) => slot.currentSku || slot.suggestedSku)?.currentSku ||
      (id ? inventory.find((i) => i.shopifyProductId.trim() === id)?.sku : "") ||
      "";
    const manyColors = new Set(slots.map((slot) => slot.color.trim().toLowerCase())).size > 1;
    for (const slot of slots) {
      if (!base || slot.key === defaultKey) continue;
      const parts = [manyColors ? colorCode(slot.color) : "", slot.size.trim()].filter(Boolean);
      if (parts.length) slot.newSkuSuggestion = `${base}-${parts.join("-")}`;
    }

    result.push({
      productId: record.productId,
      title: record.title,
      category: record.category,
      shopifyProductId: record.shopifyProductId,
      photoUrl: record.heroImageLink || record.closeupImageLink || record.lifestyleImageLink || "",
      hasVariants: rows.length > 0,
      slots,
    });
  }
  return { products: result };
}

/**
 * Links a product's pieces to Inventory SKUs, as confirmed on the Linking tab:
 * - a piece not in Inventory yet is added, from the product's own data;
 * - where weights differ, the chosen one is kept on both sides;
 * - an unpriced Inventory row takes the product's pricing (so nothing is re-priced);
 * - where stock differs, the chosen count is set on the other side;
 * - the SKU is written to the Shopify variant.
 * Then any piece whose price changed (a different weight was chosen) is
 * re-priced on the product and Shopify.
 */
export async function linkProduct(input: LinkProductInput): Promise<LinkProductResult> {
  const lookup = await findProduct(input.productId);
  if (!lookup) throw new StockInputError("Product not found.", 404);
  const { record } = lookup;
  const [inventory, products, settings, shopifyVariants] = await Promise.all([
    listInventoryItems(),
    listProducts(),
    readAppSettings(),
    shopifyVariantsOf(record),
  ]);
  const uses = skuUses(products);
  const sources = slotSources(record, shopifyVariants);
  const rows = parseVariantRows(record.variants);
  const warnings: string[] = [];

  const seen = new Set<string>();
  for (const link of input.links) {
    const sku = link.sku.trim();
    if (!sku) throw new StockInputError("Every piece to link needs a SKU.");
    if (seen.has(normalizeSku(sku))) throw new StockInputError(`SKU ${sku} is picked for two pieces.`);
    seen.add(normalizeSku(sku));
    if (!sources.some((s) => s.key === link.slotKey)) throw new StockInputError("That variant no longer exists — reload.");
    const exists = inventory.some((i) => sameSku(i.sku, sku));
    if (link.create && exists) throw new StockInputError(`SKU ${sku} is already in Inventory — pick it instead.`);
    if (!link.create && !exists) throw new StockInputError(`SKU ${sku} isn't in Inventory.`);
    if (link.create && !INVENTORY_CATEGORIES.some((c) => c.value === link.create!.category)) {
      throw new StockInputError(`Pick a category for ${sku}.`);
    }
    const elsewhere = skuUsedElsewhere(uses, sku, record.productId);
    if (elsewhere) throw new StockInputError(`SKU ${sku} is already used by ${describeSkuUse(elsewhere)}.`);
  }

  const pricingContext = {
    ratePerGram: settings.ratePerGram,
    makingChargeMode: record.makingChargeMode,
    makingChargeValue: record.makingChargeValue,
    stoneLineItems: parseStoneLineItems(record.stoneLineItems),
  };
  const today = new Date().toISOString().slice(0, 10);
  let productSku = record.sku ?? "";
  const rowSkus = new Map<string, string>();
  const reprice: string[] = [];

  for (const link of input.links) {
    const source = sources.find((s) => s.key === link.slotKey)!;
    const name = `${record.title}${source.row ? ` (${source.label})` : ""}`;
    const shopifyQty = source.shopify ? source.shopify.quantity : null;
    let item: InventoryItem;

    // The product's own pricing for this piece, based on the gross weight kept.
    const pricingFor = (gross: number) => {
      const pricing = pricingFromProduct(record, source.row);
      if (!pricing) return null;
      // No stones (net = gross): the net weight follows the weight kept.
      if (pricing.netWeightGrams === source.studioGrossWeight || pricing.netWeightGrams > gross) {
        pricing.netWeightGrams = gross;
      }
      return pricing;
    };

    if (link.create) {
      const quantity = Math.max(0, shopifyQty ?? source.studioQuantity);
      const pricing = pricingFor(source.studioGrossWeight);
      item = {
        sku: link.sku.trim(),
        category: link.create.category,
        weightGrams: source.studioGrossWeight,
        quantity,
        photoUrl: slotPhoto(record, source.row),
        shopifyProductId: record.shopifyProductId ?? "",
        createdDate: new Date().toISOString(),
        netWeightGrams: 0,
        makingChargeMode: "per_gram",
        makingChargeValue: 0,
        stoneLineItems: "",
        manualPriceOverride: false,
        manualPriceOverrideValue: 0,
        ...(pricing ? pricingFields(pricing) : {}),
        price: 0, // calculated when the row is written
      };
      await appendInventoryRow(item);
      await appendStockLogEntries([
        newStockLogEntry({
          date: today,
          type: "new",
          sku: item.sku,
          change: quantity,
          stockAfter: quantity,
          note: `Added while linking ${name}`,
        }),
      ]);
    } else {
      const current = inventory.find((i) => sameSku(i.sku, link.sku))!;
      const patch: InventoryUpdate = {};
      if (link.weight === "studio" && source.studioGrossWeight > 0 && source.studioGrossWeight !== current.weightGrams) {
        patch.weightGrams = source.studioGrossWeight;
      }
      const gross = patch.weightGrams ?? current.weightGrams;
      if (!hasPricing(current)) {
        const pricing = pricingFor(gross);
        if (pricing) Object.assign(patch, pricingFields(pricing));
      }
      if (link.stock === "shopify" && shopifyQty !== null && shopifyQty !== current.quantity) {
        patch.quantity = shopifyQty;
      }
      item = Object.keys(patch).length ? (await updateInventoryRow(current.sku, patch)).item : current;
      if (patch.quantity !== undefined) {
        await appendStockLogEntries([
          newStockLogEntry({
            date: today,
            type: "correction",
            sku: item.sku,
            change: patch.quantity - current.quantity,
            stockAfter: patch.quantity,
            note: `Set to Shopify's count when linking ${name}`,
          }),
        ]);
      }
    }

    // Shopify: the SKU on the variant, and Inventory's count where that was chosen.
    if (source.shopify && record.shopifyProductId) {
      try {
        if (!sameSku(source.shopify.sku, item.sku)) {
          await setShopifyVariantSku(record.shopifyProductId, source.shopify.variantId, item.sku);
        }
        if (link.stock === "inventory" && !link.create && source.shopify.quantity !== Math.max(0, item.quantity)) {
          await setShopifyVariantStock(source.shopify.inventoryItemId, Math.max(0, item.quantity));
        }
      } catch (error) {
        console.error(`Couldn't update Shopify while linking ${name} to ${item.sku}`, error);
        warnings.push(`${name}: linked, but Shopify couldn't be updated (${error instanceof Error ? error.message : "unknown error"}).`);
      }
    }

    if (source.row) {
      rowSkus.set(source.row.id, item.sku);
      if (source.row.id === defaultRow(record, rows)?.id && !productSku) productSku = item.sku;
    } else {
      productSku = item.sku;
    }

    // Re-price only when the price really changed — re-sending variants re-uploads photos.
    const before = source.row ? resolveVariantPrice(source.row, record.price, pricingContext) : record.price;
    const after = inventoryPrice(item, settings.ratePerGram);
    if (after !== null && after !== before) reprice.push(item.sku);
  }

  const freshInventory = await listInventoryItems();
  const linkedRows = applyInventoryToVariantRows(
    rows.map((row) => (rowSkus.has(row.id) ? { ...row, sku: rowSkus.get(row.id)! } : row)),
    freshInventory
  );
  const mainItem = freshInventory.find((i) => productSku && sameSku(i.sku, productSku));
  await updateProductRow(record.productId, {
    sku: productSku,
    ...(rows.length
      ? {
          variants: serializeVariantRows(linkedRows),
          inventory: linkedRows.reduce((sum, row) => sum + row.inventory, 0),
        }
      : mainItem
        ? { inventory: Math.max(0, mainItem.quantity) }
        : {}),
  });

  for (const sku of reprice) {
    const results = await applyInventoryPricingToProducts(sku);
    for (const r of results.filter((r) => r.error || r.priceSyncStatus === "out_of_sync")) {
      warnings.push(`${r.title}: new price ${r.error ? `not saved (${r.error})` : "saved, but Shopify sync failed — retry on Finalize"}.`);
    }
  }

  return { linked: input.links.length, warnings };
}
