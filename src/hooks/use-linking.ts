"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { LinkingOverview, LinkProductInput, LinkProductResult } from "@/types/product-linking";

async function readError(res: Response, fallback: string): Promise<Error> {
  const data = await res.json().catch(() => null);
  return new Error(data?.error ?? fallback);
}

/** Products and the pieces they sell, for the Inventory page's Linking tab (services/product-linking.ts). */
export function useLinkingOverview(enabled: boolean) {
  return useQuery({
    queryKey: ["inventory-linking"],
    queryFn: async (): Promise<LinkingOverview> => {
      const res = await fetch("/api/inventory/linking");
      if (!res.ok) throw await readError(res, "Couldn't load products to link.");
      return (await res.json()) as LinkingOverview;
    },
    enabled,
    // Reads every product's variants from Shopify — only refetched after a link or on request.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
}

export function useLinkProduct() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: LinkProductInput): Promise<LinkProductResult> => {
      const res = await fetch("/api/inventory/linking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) throw await readError(res, "Couldn't link this product.");
      return (await res.json()) as LinkProductResult;
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory-linking"] });
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
      queryClient.invalidateQueries({ queryKey: ["stock-log"] });
      queryClient.invalidateQueries({ queryKey: ["products-list"] });
      queryClient.invalidateQueries({ queryKey: ["product"] });
    },
  });
}
