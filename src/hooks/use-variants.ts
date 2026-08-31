"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { VariantRow, VariantColorImageSet } from "@/lib/variants";

export interface SaveProductVariantsResult {
  variants: VariantRow[];
  variantsSyncStatus: "synced" | "out_of_sync" | "";
  variantsSyncedAt: string;
}

/** Finalize's Variants panel "Save" — see api/products/[productId]/variants/route.ts. */
export function useSaveProductVariants() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ productId, variants }: { productId: string; variants: VariantRow[] }) => {
      const res = await fetch(`/api/products/${productId}/variants`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ variants }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "Couldn't save variants.");
      }
      return (await res.json()) as SaveProductVariantsResult;
    },
    onSuccess: (_result, { productId }) => {
      queryClient.invalidateQueries({ queryKey: ["product", productId] });
    },
  });
}

/** Generates Hero/Lifestyle/Closeup photos for one variant Color — the Variants panel's "Generate Photos" action. See api/products/[productId]/variants/generate-images/route.ts. */
export function useGenerateVariantColorImages() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ productId, color }: { productId: string; color: string }) => {
      const res = await fetch(`/api/products/${productId}/variants/generate-images`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ color }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "Couldn't generate variant photos.");
      }
      return (await res.json()) as VariantColorImageSet;
    },
    onSuccess: (_result, { productId }) => {
      queryClient.invalidateQueries({ queryKey: ["product", productId] });
    },
  });
}

/** Manually adds one photo to a variant Color's gallery — the escape hatch when an AI-generated shot isn't good enough. See api/products/[productId]/variants/upload-image/route.ts. */
export function useUploadVariantColorImage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ productId, color, file }: { productId: string; color: string; file: File }) => {
      const formData = new FormData();
      formData.append("color", color);
      formData.append("file", file);
      const res = await fetch(`/api/products/${productId}/variants/upload-image`, {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "Couldn't upload the image.");
      }
      return (await res.json()) as VariantColorImageSet;
    },
    onSuccess: (_result, { productId }) => {
      queryClient.invalidateQueries({ queryKey: ["product", productId] });
    },
  });
}

/** Removes one photo from a variant Color's gallery. See api/products/[productId]/variants/upload-image/route.ts's DELETE handler. */
export function useRemoveVariantColorImage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ productId, color, imageId }: { productId: string; color: string; imageId: string }) => {
      const res = await fetch(`/api/products/${productId}/variants/upload-image`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ color, imageId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "Couldn't remove the image.");
      }
      return (await res.json()) as VariantColorImageSet;
    },
    onSuccess: (_result, { productId }) => {
      queryClient.invalidateQueries({ queryKey: ["product", productId] });
    },
  });
}

/** Retries a failed Shopify variants push for one product — the "out of sync" badge's retry button. */
export function useRetryVariantsSync() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (productId: string) => {
      const res = await fetch(`/api/products/${productId}/variants`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "Couldn't sync to Shopify.");
      }
      return (await res.json()) as SaveProductVariantsResult;
    },
    onSuccess: (_result, productId) => {
      queryClient.invalidateQueries({ queryKey: ["product", productId] });
    },
  });
}
