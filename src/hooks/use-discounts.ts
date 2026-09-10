"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export type DiscountScope =
  | { type: "global" }
  | { type: "collection"; collectionId: string }
  | { type: "tag"; tag: string };

export interface DiscountResult {
  productsUpdated: number;
  variantsUpdated: number;
  failed: { productId: string; message: string }[];
}

/** Discounts tab's Collection picker — see api/discounts/collections/route.ts. */
export function useCollectionsList() {
  return useQuery({
    queryKey: ["discounts", "collections"],
    queryFn: async () => {
      const res = await fetch("/api/discounts/collections");
      if (!res.ok) throw new Error("Couldn't load collections.");
      const data = (await res.json()) as { collections: { id: string; title: string }[] };
      return data.collections;
    },
  });
}

/** Discounts tab's Tag picker — see api/discounts/tags/route.ts. */
export function useTagsList() {
  return useQuery({
    queryKey: ["discounts", "tags"],
    queryFn: async () => {
      const res = await fetch("/api/discounts/tags");
      if (!res.ok) throw new Error("Couldn't load tags.");
      const data = (await res.json()) as { tags: string[] };
      return data.tags;
    },
  });
}

export interface DiscountPreview {
  productCount: number;
  variantCount: number;
  sampleTitles: string[];
}

/**
 * Live "Matches N products" line, refetched whenever the chosen scope
 * changes. `enabled` gates it off until the scope is actually complete (a
 * collection/tag scope with nothing picked yet has nothing to preview).
 */
export function useDiscountPreview(scope: DiscountScope | null) {
  return useQuery({
    queryKey: ["discounts", "preview", scope],
    queryFn: async () => {
      const res = await fetch("/api/discounts/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "Couldn't preview this scope.");
      }
      return (await res.json()) as DiscountPreview;
    },
    enabled: scope != null,
  });
}

/** Discounts tab's "Apply Discount" — see api/discounts/apply/route.ts. */
export function useApplyDiscount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ scope, percent }: { scope: DiscountScope; percent: number }) => {
      const res = await fetch("/api/discounts/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope, percent }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "Couldn't apply the discount.");
      }
      return (await res.json()) as DiscountResult;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["discounts"] });
      queryClient.invalidateQueries({ queryKey: ["products-list"] });
    },
  });
}

/** Discounts tab's "Remove Discount" — see api/discounts/remove/route.ts. */
export function useRemoveDiscount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (scope: DiscountScope) => {
      const res = await fetch("/api/discounts/remove", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "Couldn't remove the discount.");
      }
      return (await res.json()) as DiscountResult;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["discounts"] });
      queryClient.invalidateQueries({ queryKey: ["products-list"] });
    },
  });
}
