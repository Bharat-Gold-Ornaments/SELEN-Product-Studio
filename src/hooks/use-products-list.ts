"use client";

import { useQuery } from "@tanstack/react-query";
import type { ProductRecord } from "@/types/product";

async function fetchProducts(): Promise<ProductRecord[]> {
  const res = await fetch("/api/products");
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error ?? "Couldn't load products.");
  }
  const { products } = (await res.json()) as { products: ProductRecord[] };
  return products;
}

/**
 * Full product list backing the /products table — same GET /api/products
 * route the dashboard reads (services/google-sheets.ts), just without the
 * dashboard's aggregation into stats/recent/queue buckets.
 */
export function useProductsList() {
  return useQuery({
    queryKey: ["products-list"],
    queryFn: fetchProducts,
  });
}
