"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ProductType } from "@/types/product";

/** Mirrors ImportCandidateResponse in api/products/import-candidates/route.ts — duplicated here (rather than imported) so this client hook never pulls that server route module into the client bundle graph, same convention every other hook in this file's neighborhood follows. */
export interface ImportCandidate {
  shopifyProductId: string;
  title: string;
  descriptionHtml: string;
  tags: string[];
  productType: string;
  createdAt: string;
  seoTitle: string;
  metaDescription: string;
  imageUrls: string[];
  price: number;
  inventory: number;
  collections: string[];
  weightGrams: number | null;
  stone: string | null;
  finish: string | null;
  widthCm: number | null;
  lengthCm: number | null;
  guessedCategory: ProductType | null;
}

/** Shopify products not yet tracked in the Sheet — the "Import from Shopify" review screen's data source. See api/products/import-candidates/route.ts. */
export function useImportCandidates() {
  return useQuery({
    queryKey: ["import-candidates"],
    queryFn: async () => {
      const res = await fetch("/api/products/import-candidates");
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "Couldn't load Shopify products.");
      }
      const data = (await res.json()) as { candidates: ImportCandidate[] };
      return data.candidates;
    },
  });
}

interface ImportSelection {
  candidate: ImportCandidate;
  category: ProductType;
  grossWeightGrams: number;
  makingChargeValue: number;
}

interface ImportResult {
  imported: number;
  failed: { shopifyProductId: string; message: string }[];
}

/** Creates a Sheet row per confirmed selection. See api/products/import/route.ts. */
export function useImportProducts() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (selections: ImportSelection[]) => {
      const res = await fetch("/api/products/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selections }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "Import failed.");
      }
      return (await res.json()) as ImportResult;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["products-list"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-data"] });
      queryClient.invalidateQueries({ queryKey: ["import-candidates"] });
    },
  });
}
