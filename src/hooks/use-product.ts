"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { ProductRecord } from "@/types/product";

/** A single product's full Sheet row — what the Finalize screen loads. See api/products/[productId]/route.ts. */
export function useProduct(productId: string) {
  return useQuery({
    queryKey: ["product", productId],
    queryFn: async () => {
      const res = await fetch(`/api/products/${productId}`);
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "Couldn't load this product.");
      }
      const data = (await res.json()) as { record: ProductRecord };
      return data.record;
    },
  });
}

interface PublishInput {
  productId: string;
  price: number;
  inventory: number;
}

interface PublishResult {
  shopifyProductId: string;
  adminUrl: string;
}

/** Publishes a finalized product to Shopify — the Finalize screen's "Publish" button. See api/products/[productId]/publish/route.ts. */
export function usePublishProduct() {
  return useMutation({
    mutationFn: async ({ productId, price, inventory }: PublishInput) => {
      const res = await fetch(`/api/products/${productId}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ price, inventory }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "Publishing failed.");
      }
      return (await res.json()) as PublishResult;
    },
  });
}

/**
 * Deletes a product — its Drive images and Sheet row (see the DELETE
 * handler in api/products/[productId]/route.ts; refuses anything already
 * published to Shopify). Invalidates every query that reads the product
 * list — ["products-list"] (the /products table) and ["dashboard-data"]
 * (the /dashboard summaries) — plus this product's own ["product", id]
 * entry, so all three surfaces drop the deleted row on their next render
 * without a manual refetch() at each call site.
 */
export function useDeleteProduct() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (productId: string) => {
      const res = await fetch(`/api/products/${productId}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "Deleting failed.");
      }
    },
    onSuccess: (_data, productId) => {
      queryClient.invalidateQueries({ queryKey: ["products-list"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-data"] });
      queryClient.removeQueries({ queryKey: ["product", productId] });
    },
  });
}
