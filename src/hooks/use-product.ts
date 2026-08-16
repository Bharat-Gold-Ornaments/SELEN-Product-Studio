"use client";

import { useQuery, useMutation } from "@tanstack/react-query";
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
