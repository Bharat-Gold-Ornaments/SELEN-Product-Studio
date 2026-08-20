"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { StoneLineItem, MakingChargeMode } from "@/lib/pricing";

export interface RateChangeLogEntry {
  timestamp: string;
  oldRate: number;
  newRate: number;
  changedBy: string;
}

/** Settings' Rate Change Audit Log panel — see api/pricing/rate-log/route.ts. */
export function useRateLog() {
  return useQuery({
    queryKey: ["rate-log"],
    queryFn: async () => {
      const res = await fetch("/api/pricing/rate-log");
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "Couldn't load the rate change log.");
      }
      const data = (await res.json()) as { entries: RateChangeLogEntry[] };
      return data.entries;
    },
  });
}

export interface UpdateAllPricesResult {
  ratePerGram: number;
  updated: number;
  skipped: number;
  failed: { productId: string; message: string }[];
}

/** Settings' "Update All Prices" action — see api/pricing/update-all/route.ts. */
export function useUpdateAllPrices() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (ratePerGram: number) => {
      const res = await fetch("/api/pricing/update-all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ratePerGram }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "Couldn't update prices.");
      }
      return (await res.json()) as UpdateAllPricesResult;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["app-settings"] });
      queryClient.invalidateQueries({ queryKey: ["rate-log"] });
      queryClient.invalidateQueries({ queryKey: ["products-list"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-data"] });
    },
  });
}

export interface SaveProductPricingInput {
  productId: string;
  grossWeightGrams: number;
  netWeightGrams: number;
  makingChargeMode: MakingChargeMode;
  makingChargeValue: number;
  stoneLineItems: StoneLineItem[];
  manualPriceOverride: boolean;
  manualPriceOverrideValue?: number;
}

export interface SaveProductPricingResult {
  price: number;
  priceSyncStatus: "synced" | "out_of_sync" | "";
  priceSyncedAt: string;
}

/** Finalize's pricing panel "Save" — see api/products/[productId]/pricing/route.ts. */
export function useSaveProductPricing() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ productId, ...input }: SaveProductPricingInput) => {
      const res = await fetch(`/api/products/${productId}/pricing`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "Couldn't save pricing.");
      }
      return (await res.json()) as SaveProductPricingResult;
    },
    onSuccess: (_result, { productId }) => {
      queryClient.invalidateQueries({ queryKey: ["product", productId] });
    },
  });
}

/** Retries a failed Shopify price push for one product — the "out of sync" badge's retry button. */
export function useRetryPriceSync() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (productId: string) => {
      const res = await fetch(`/api/products/${productId}/pricing`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "Couldn't sync to Shopify.");
      }
      return (await res.json()) as SaveProductPricingResult;
    },
    onSuccess: (_result, productId) => {
      queryClient.invalidateQueries({ queryKey: ["product", productId] });
    },
  });
}
