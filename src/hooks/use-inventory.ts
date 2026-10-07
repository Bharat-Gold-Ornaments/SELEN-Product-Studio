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
  /** The row's current SKU — how it's found. */
  sku: string;
  /** Set to rename the SKU. */
  newSku?: string;
  category?: InventoryCategory;
  weightGrams?: number;
  shopifyProductId?: string;
  quantity?: number;
  /** Replaces the saved photo. */
  photo?: File;
  /** Clears the saved photo (ignored if `photo` is set). */
  removePhoto?: boolean;
}

/**
 * Edits an existing row. Applied to the cached table immediately and rolled
 * back if the save fails.
 */
export function useUpdateInventoryItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ sku, newSku, photo, removePhoto, ...fields }: UpdateInventoryItemInput) => {
      const formData = new FormData();
      if (newSku !== undefined) formData.append("sku", newSku);
      for (const [key, value] of Object.entries(fields)) {
        if (value !== undefined) formData.append(key, String(value));
      }
      if (photo) formData.append("photo", photo);
      else if (removePhoto) formData.append("removePhoto", "true");

      const res = await fetch(`/api/inventory/${encodeURIComponent(sku)}`, { method: "PATCH", body: formData });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "Couldn't update this item.");
      }
      const data = (await res.json()) as { item: InventoryItem };
      return data.item;
    },
    // A new photo only shows once the refetch brings back its saved URL.
    onMutate: async ({ sku, newSku, photo, removePhoto, ...fields }) => {
      await queryClient.cancelQueries({ queryKey: ["inventory"] });
      const previous = queryClient.getQueryData<InventoryItem[]>(["inventory"]);
      queryClient.setQueryData<InventoryItem[]>(["inventory"], (items) =>
        items?.map((item) => {
          if (item.sku !== sku) return item;
          const next = { ...item, ...fields, sku: newSku ?? item.sku };
          if (removePhoto && !photo) next.photoUrl = "";
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
