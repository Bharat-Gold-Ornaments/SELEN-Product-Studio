"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { InventoryCategory, InventoryItem } from "@/types/inventory";

async function fetchInventory(): Promise<InventoryItem[]> {
  const res = await fetch("/api/inventory");
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error ?? "Couldn't load inventory.");
  }
  const { items } = (await res.json()) as { items: InventoryItem[] };
  return items;
}

/** Inventory tab rows backing the /inventory table (services/google-sheets.ts). */
export function useInventory() {
  return useQuery({
    queryKey: ["inventory"],
    queryFn: fetchInventory,
  });
}

export interface AddInventoryItemInput {
  sku: string;
  category: InventoryCategory;
  weightGrams: string;
  quantity: string;
  shopifyProductId: string;
  photo: File | null;
}

export function useAddInventoryItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ sku, category, weightGrams, quantity, shopifyProductId, photo }: AddInventoryItemInput) => {
      const formData = new FormData();
      formData.append("sku", sku);
      formData.append("category", category);
      formData.append("weightGrams", weightGrams);
      formData.append("quantity", quantity);
      formData.append("shopifyProductId", shopifyProductId);
      if (photo) formData.append("photo", photo);

      const res = await fetch("/api/inventory", { method: "POST", body: formData });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "Couldn't save this item.");
      }
      const data = (await res.json()) as { item: InventoryItem };
      return data.item;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
    },
  });
}

export interface UpdateInventoryItemInput {
  sku: string;
  category?: InventoryCategory;
  weightGrams?: number;
  shopifyProductId?: string;
  quantity?: number;
  quantityDelta?: number;
}

/**
 * Edits an existing row. Applied to the cached table immediately (so the
 * +/- buttons feel instant) and rolled back if the save fails.
 */
export function useUpdateInventoryItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ sku, ...update }: UpdateInventoryItemInput) => {
      const res = await fetch(`/api/inventory/${encodeURIComponent(sku)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(update),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "Couldn't update this item.");
      }
      const data = (await res.json()) as { item: InventoryItem };
      return data.item;
    },
    onMutate: async ({ sku, quantityDelta, ...fields }) => {
      await queryClient.cancelQueries({ queryKey: ["inventory"] });
      const previous = queryClient.getQueryData<InventoryItem[]>(["inventory"]);
      queryClient.setQueryData<InventoryItem[]>(["inventory"], (items) =>
        items?.map((item) => {
          if (item.sku !== sku) return item;
          const next = { ...item, ...fields };
          if (quantityDelta !== undefined) next.quantity = Math.max(0, item.quantity + quantityDelta);
          return next;
        })
      );
      return { previous };
    },
    onError: (_error, _input, context) => {
      if (context?.previous) queryClient.setQueryData(["inventory"], context.previous);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
    },
  });
}
