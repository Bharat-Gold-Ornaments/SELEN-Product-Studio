import { parseVariantRows, type VariantRow } from "@/lib/variants";
import { normalizeSku } from "@/lib/sku";
import type { ProductRecord } from "@/types/product";

/** Where an Inventory SKU is used: a product without variants, or one variant of a product. */
export interface SkuUse {
  productId: string;
  title: string;
  /** "Rose Gold / 16" for a variant; null for the product itself. */
  variant: string | null;
  /** The variant row's id, for a variant. */
  variantId: string | null;
}

export function variantLabel(row: Pick<VariantRow, "color" | "size">): string {
  return [row.color, row.size].map((v) => v.trim()).filter(Boolean).join(" / ") || "Variant";
}

/**
 * Every SKU a product sells: one per variant when it has variants (each is
 * its own physical piece), otherwise the product's own SKU. A product with
 * variants also keeps the SKU it was created from as its main SKU, which
 * drives its main price.
 */
export function productSkuUses(record: ProductRecord): { sku: string; use: SkuUse }[] {
  const uses: { sku: string; use: SkuUse }[] = [];
  const rows = parseVariantRows(record.variants);
  for (const row of rows) {
    if (!row.sku) continue;
    uses.push({
      sku: row.sku,
      use: { productId: record.productId, title: record.title, variant: variantLabel(row), variantId: row.id },
    });
  }
  if (record.sku && !rows.some((row) => row.sku && normalizeSku(row.sku) === normalizeSku(record.sku))) {
    uses.push({ sku: record.sku, use: { productId: record.productId, title: record.title, variant: null, variantId: null } });
  }
  return uses;
}

/** Normalized SKU → where it's used, across all products. */
export function skuUses(products: ProductRecord[]): Map<string, SkuUse[]> {
  const map = new Map<string, SkuUse[]>();
  for (const record of products) {
    for (const { sku, use } of productSkuUses(record)) {
      const key = normalizeSku(sku);
      map.set(key, [...(map.get(key) ?? []), use]);
    }
  }
  return map;
}

/** The first use of `sku` by a product other than `productId`, if any — each SKU sells through one product only. */
export function skuUsedElsewhere(uses: Map<string, SkuUse[]>, sku: string, productId: string): SkuUse | undefined {
  return uses.get(normalizeSku(sku))?.find((use) => use.productId !== productId);
}

export function describeSkuUse(use: SkuUse): string {
  return use.variant ? `${use.title} (${use.variant})` : use.title;
}
