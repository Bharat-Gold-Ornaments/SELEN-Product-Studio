"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { InventoryCategory, InventoryItem } from "@/types/inventory";
import type { StockLogEntry } from "@/types/stock-log";
import { pricingFields, type InventoryPricing, type LinkedProductPriceResult } from "@/lib/inventory-pricing";

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
  /** Required for a new design. */
  pricing: InventoryPricing;
}

export function useAddInventoryItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ sku, category, weightGrams, quantity, shopifyProductId, photo, pricing }: AddInventoryItemInput) => {
      const formData = new FormData();
      formData.append("sku", sku);
      formData.append("category", category);
      formData.append("weightGrams", weightGrams);
      formData.append("quantity", quantity);
      formData.append("shopifyProductId", shopifyProductId);
      if (photo) formData.append("photo", photo);
      formData.append("pricing", JSON.stringify(pricing));

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
      queryClient.invalidateQueries({ queryKey: ["stock-log"] });
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
  /** New pricing — also applied to the products created from this SKU and their Shopify price. */
  pricing?: InventoryPricing;
}

export interface UpdateInventoryItemResult {
  item: InventoryItem;
  /** Products created from this SKU whose price was updated to match (services/inventory-pricing.ts). */
  linkedProducts: LinkedProductPriceResult[];
}

/**
 * Edits an existing row. Applied to the cached table immediately and rolled
 * back if the save fails.
 */
export function useUpdateInventoryItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ sku, newSku, photo, removePhoto, pricing, ...fields }: UpdateInventoryItemInput): Promise<UpdateInventoryItemResult> => {
      const formData = new FormData();
      if (newSku !== undefined) formData.append("sku", newSku);
      for (const [key, value] of Object.entries(fields)) {
        if (value !== undefined) formData.append(key, String(value));
      }
      if (photo) formData.append("photo", photo);
      else if (removePhoto) formData.append("removePhoto", "true");
      if (pricing) formData.append("pricing", JSON.stringify(pricing));

      const res = await fetch(`/api/inventory/${encodeURIComponent(sku)}`, { method: "PATCH", body: formData });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "Couldn't update this item.");
      }
      return (await res.json()) as UpdateInventoryItemResult;
    },
    // A new photo only shows once the refetch brings back its saved URL.
    onMutate: async ({ sku, newSku, photo, removePhoto, pricing, ...fields }) => {
      await queryClient.cancelQueries({ queryKey: ["inventory"] });
      const previous = queryClient.getQueryData<InventoryItem[]>(["inventory"]);
      queryClient.setQueryData<InventoryItem[]>(["inventory"], (items) =>
        items?.map((item) => {
          if (item.sku !== sku) return item;
          const next = { ...item, ...fields, ...(pricing ? pricingFields(pricing) : {}), sku: newSku ?? item.sku };
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
      queryClient.invalidateQueries({ queryKey: ["stock-log"] });
      queryClient.invalidateQueries({ queryKey: ["products-list"] });
      queryClient.invalidateQueries({ queryKey: ["product"] });
    },
  });
}

async function readError(res: Response, fallback: string): Promise<Error> {
  const data = await res.json().catch(() => null);
  return new Error(data?.error ?? fallback);
}

/** Restock and merge change stock, Shopify-linked Products tab rows and the Stock Log. */
function useInvalidateStock() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: ["inventory"] });
    queryClient.invalidateQueries({ queryKey: ["stock-log"] });
    queryClient.invalidateQueries({ queryKey: ["products-list"] });
    queryClient.invalidateQueries({ queryKey: ["product"] });
  };
}

export interface RestockInput {
  sku: string;
  quantity: number;
  recordedBy: string;
  /** YYYY-MM-DD the stock arrived. */
  date: string;
}

/** More pieces of an existing design — added on Inventory and Shopify (services/stock.ts). */
export function useRestockItem() {
  const invalidate = useInvalidateStock();
  return useMutation({
    mutationFn: async (input: RestockInput): Promise<StockLogEntry> => {
      const res = await fetch("/api/inventory/restock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) throw await readError(res, "Couldn't add this stock.");
      const { entry } = (await res.json()) as { entry: StockLogEntry };
      return entry;
    },
    onSettled: invalidate,
  });
}

export function useMergeInventoryItems() {
  const invalidate = useInvalidateStock();
  return useMutation({
    mutationFn: async (input: {
      keepSku: string;
      removeSku: string;
      recordedBy: string;
    }): Promise<{ item: InventoryItem; warnings: string[] }> => {
      const res = await fetch("/api/inventory/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) throw await readError(res, "Couldn't merge these items.");
      return (await res.json()) as { item: InventoryItem; warnings: string[] };
    },
    onSettled: invalidate,
  });
}

/** Pair keys marked "Not a duplicate" (lib/inventory-duplicates.ts). */
export function useDismissedDuplicates() {
  return useQuery({
    queryKey: ["inventory-duplicate-dismissals"],
    queryFn: async (): Promise<string[]> => {
      const res = await fetch("/api/inventory/duplicates");
      if (!res.ok) throw await readError(res, "Couldn't load the duplicate check.");
      const { dismissed } = (await res.json()) as { dismissed: string[] };
      return dismissed;
    },
  });
}

export function useDismissDuplicate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ skuA, skuB }: { skuA: string; skuB: string }): Promise<string[]> => {
      const res = await fetch("/api/inventory/duplicates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skuA, skuB }),
      });
      if (!res.ok) throw await readError(res, "Couldn't save that.");
      const { dismissed } = (await res.json()) as { dismissed: string[] };
      return dismissed;
    },
    onSuccess: (dismissed) => queryClient.setQueryData(["inventory-duplicate-dismissals"], dismissed),
  });
}
