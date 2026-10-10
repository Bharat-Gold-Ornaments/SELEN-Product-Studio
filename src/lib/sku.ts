/**
 * The form SKUs are compared in everywhere (Inventory, Products tab,
 * Shopify): trimmed and upper-cased, so "rra001 " and "RRA001" count as the
 * same SKU. The original spelling is still what gets stored and shown.
 */
export function normalizeSku(sku: string): string {
  return sku.trim().toUpperCase();
}

export function sameSku(a: string, b: string): boolean {
  return normalizeSku(a) === normalizeSku(b);
}
