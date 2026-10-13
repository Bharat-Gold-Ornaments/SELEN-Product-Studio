import "server-only";
import { listProducts, updateProductRow } from "@/services/google-sheets";
import { parseVariantRows, serializeVariantRows } from "@/lib/variants";
import { sameSku } from "@/lib/sku";

/**
 * Points every product and variant that sells `oldSku` at `newSku` — after
 * an Inventory SKU is renamed, or merged into another. Returns how many
 * products changed.
 */
export async function replaceSkuInProducts(oldSku: string, newSku: string): Promise<number> {
  let changed = 0;
  for (const product of await listProducts()) {
    const rows = parseVariantRows(product.variants);
    const rowsChanged = rows.some((row) => row.sku && sameSku(row.sku, oldSku));
    const productChanged = Boolean(product.sku && sameSku(product.sku, oldSku));
    if (!rowsChanged && !productChanged) continue;
    await updateProductRow(product.productId, {
      ...(productChanged ? { sku: newSku } : {}),
      ...(rowsChanged
        ? {
            variants: serializeVariantRows(
              rows.map((row) => (row.sku && sameSku(row.sku, oldSku) ? { ...row, sku: newSku } : row))
            ),
          }
        : {}),
    });
    changed++;
  }
  return changed;
}
