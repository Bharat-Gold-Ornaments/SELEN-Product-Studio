"use client";

import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { ProductType, ImageCategory } from "@/types/product";
import type { ProductFormValues } from "@/lib/product-schemas";
import type { ImagePromptVariables } from "@/lib/generation-variables";

export type CategoryGenerationResult =
  | { category: ImageCategory; status: "success"; imageUrls: string[] }
  | { category: ImageCategory; status: "error"; message: string };

export interface ProductFolders {
  categoryFolderId: string;
  productFolderId: string;
  originalsFolderId: string;
  generatedFolderId: string;
}

/**
 * Everything the Review screen needs, held in the TanStack Query cache under
 * a per-product key. Set directly after a fresh Generate/Regenerate call
 * (useStartGeneration below), or reconstructed by useProductReview from
 * Google Sheets + Drive when there's no in-memory copy yet — e.g. after a
 * hard refresh, or navigating to Review from the Products list. The one
 * piece that never survives a reload either way is `originalPhotos` (actual
 * File objects can't be persisted), so a reconstructed session always starts
 * with none.
 */
export interface GenerationSession {
  productId: string;
  productType: ProductType;
  driveFolders: ProductFolders | null;
  driveError: string | null;
  /**
   * Non-fatal, same treatment as driveError — a Google Sheets write failure
   * (missing credentials, sheet not shared with the service account, etc.)
   * never blocks Generate, but it does mean this product won't show up on
   * the dashboard or Products list until it's fixed and the product is
   * regenerated. See services/google-sheets.ts.
   */
  sheetsError: string | null;
  imageResults: CategoryGenerationResult[];
  variables: ImagePromptVariables;
  selected: Partial<Record<ImageCategory, string>>;
  /**
   * Kept in memory so "Retry upload" can resubmit the same originals.
   * Every photo is optional — a product can be generated with only some
   * (or none) of its reference shots on hand.
   */
  originalPhotos: { front?: File | null; side?: File | null; worn?: File | null };
  /**
   * Drive file ids for any slot that was filled from the Uploads pool
   * instead of a local file (see dynamic-product-form.tsx) — kept
   * alongside originalPhotos so Regenerate can still use that photo as an
   * image-to-image reference, the same way it does for a local File. Like
   * originalPhotos, this doesn't survive a reload via useProductReview
   * (the reconstructed session has no way to know which pool photo, if
   * any, a slot originally came from), so a reloaded product's Regenerate
   * falls back to text-only for slots that were pool-sourced.
   */
  poolPhotoIds: { front?: string; side?: string; worn?: string };
  /**
   * AI-generated product copy (Milestone 7) — null until the user hits
   * "Generate Copy" on the Review screen. Not auto-generated, matching how
   * Drive retry and image Regenerate are also user-triggered rather than
   * automatic (see CopySection). Reloaded from the sheet by useProductReview
   * whenever the row already has a saved description.
   */
  copy: ProductCopy | null;
}

/** The four AI-generated copy fields for a product, once generated and/or saved. */
export interface ProductCopy {
  title: string;
  description: string;
  tags: string[];
  seoTitle: string;
  metaDescription: string;
}

type CopyFieldResult<T> = { status: "success"; value: T } | { status: "error"; message: string };

/** Mirrors services/anthropic-copy.ts's CopyGenerationResult — kept as a separate client-side type since that module is server-only. */
export interface CopyGenerationResult {
  title: CopyFieldResult<string>;
  description: CopyFieldResult<string>;
  tags: CopyFieldResult<string[]>;
  seo: CopyFieldResult<{ seoTitle: string; metaDescription: string }>;
}

function sessionKey(productId: string) {
  return ["generation-session", productId] as const;
}

export function getGenerationSession(
  queryClient: QueryClient,
  productId: string
): GenerationSession | undefined {
  return queryClient.getQueryData<GenerationSession>(sessionKey(productId));
}

export function setGenerationSession(
  queryClient: QueryClient,
  productId: string,
  updater: GenerationSession | ((prev: GenerationSession) => GenerationSession)
) {
  queryClient.setQueryData<GenerationSession>(sessionKey(productId), (prev) => {
    if (typeof updater === "function") {
      if (!prev) return prev;
      return updater(prev);
    }
    return updater;
  });
}

/**
 * Reloads an already-generated product from Google Sheets + Drive when
 * there's no in-memory session for it — e.g. the browser was refreshed, or
 * the user got here from the Products list rather than straight from
 * Generate. Seeds the same query-cache slot `getGenerationSession` reads
 * from on success, so Select/Regenerate work exactly as they would for a
 * freshly generated session. `originalPhotos` can't be recovered this way
 * (no File objects survive a page reload), so it comes back empty — Retry
 * Upload/Regenerate simply fall back to no reference photos, same as a
 * product that was generated without any to begin with.
 */
export function useProductReview(productId: string, enabled: boolean) {
  const queryClient = useQueryClient();

  return useQuery({
    queryKey: ["product-review", productId],
    enabled,
    queryFn: async () => {
      const res = await fetch(`/api/products/${productId}/review`);
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "Couldn't load this product's images.");
      }
      const data = (await res.json()) as Omit<GenerationSession, "originalPhotos" | "poolPhotoIds">;
      const session: GenerationSession = { ...data, originalPhotos: {}, poolPhotoIds: {} };
      queryClient.setQueryData(sessionKey(productId), session);
      return session;
    },
    retry: false,
  });
}

interface StartGenerationInput {
  productId: string;
  productType: ProductType;
  values: ProductFormValues;
  /**
   * Which of Hero/Lifestyle/Closeup to generate, from the Create Product
   * form's checkboxes. Omitted (or empty) means "all of them" — see the
   * fallback in /api/products/generate.
   */
  imageCategories?: ImageCategory[];
  /**
   * Drive file ids for any slot filled from the Uploads pool instead of a
   * local file — mutually exclusive per slot with values.frontPhoto etc.
   * (see dynamic-product-form.tsx). The API route downloads these straight
   * from Drive and marks them used once generation succeeds.
   */
  poolPhotoIds?: { front?: string; side?: string; worn?: string };
}

export function useStartGeneration() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ productId, values, imageCategories, poolPhotoIds }: StartGenerationInput) => {
      // Direct property access on the union is cheap (every member
      // shares these fields with the same type). Spreading "everything
      // except these keys" out of a union is not — it forces TypeScript to
      // distribute the computation across every member — so `rest` is
      // built separately via a plain Record cast instead.
      const { frontPhoto, sidePhoto, wornPhoto } = values;
      const raw = values as unknown as Record<string, unknown>;
      const rest = Object.fromEntries(
        Object.entries(raw).filter(([key]) => !["frontPhoto", "sidePhoto", "wornPhoto"].includes(key))
      );

      const formData = new FormData();
      formData.append("productId", productId);
      formData.append("fields", JSON.stringify(rest));
      if (imageCategories) {
        formData.append("imageCategories", JSON.stringify(imageCategories));
      }
      if (poolPhotoIds) {
        formData.append("poolPhotoIds", JSON.stringify(poolPhotoIds));
      }
      // Only append photos that were actually provided — all three are
      // optional, and an absent FormData entry is how the API route tells
      // "not provided" apart from "provided but invalid". A slot filled
      // from the pool has no local File to append here at all.
      if (frontPhoto instanceof File) formData.append("frontPhoto", frontPhoto);
      if (sidePhoto instanceof File) formData.append("sidePhoto", sidePhoto);
      if (wornPhoto instanceof File) formData.append("wornPhoto", wornPhoto);

      const res = await fetch("/api/products/generate", { method: "POST", body: formData });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "Generation failed.");
      }

      return (await res.json()) as {
        productId: string;
        driveFolders: ProductFolders | null;
        driveError: string | null;
        sheetsError: string | null;
        imageResults: CategoryGenerationResult[];
        variables: ImagePromptVariables;
      };
    },
    onSuccess: (data, input) => {
      const session: GenerationSession = {
        ...data,
        productType: input.productType,
        selected: {},
        originalPhotos: {
          front: input.values.frontPhoto,
          side: input.values.sidePhoto,
          worn: input.values.wornPhoto,
        },
        poolPhotoIds: input.poolPhotoIds ?? {},
        copy: null,
      };
      queryClient.setQueryData(sessionKey(data.productId), session);
    },
  });
}

interface RegenerateInput {
  productId: string;
  category: ImageCategory;
  variables: ImagePromptVariables;
  /**
   * Every reference photo used for the initial generation (front/side/worn,
   * whichever were actually provided) — resent so the regenerated image
   * stays visually consistent via image-to-image, and so v2 models that
   * accept multiple references (FLUX Kontext, GPT Image 2) still get all of
   * them, not just one. Optional: regeneration still works with none,
   * falling back to text-to-image just like the initial generation does.
   */
  referencePhotos?: (File | null | undefined)[];
  /**
   * Drive file ids for any slot that was filled from the Uploads pool
   * instead of a local file (from the session's poolPhotoIds) — sent
   * alongside referencePhotos so a regenerate still uses that photo as an
   * image-to-image reference instead of silently dropping it. Whichever
   * slots aren't in here are assumed covered by referencePhotos instead.
   */
  poolPhotoIds?: { front?: string; side?: string; worn?: string };
  /**
   * The product's existing Drive "generated" folder id (from the session's
   * driveFolders, set during the initial generation) so the regenerated
   * image gets saved to Drive too, not just the initial batch. Null/omitted
   * when Drive setup failed initially — regeneration still works, the
   * image just isn't saved to Drive, same as the initial batch in that case.
   */
  generatedFolderId?: string | null;
}

export function useRegenerateCategory() {
  return useMutation({
    mutationFn: async ({
      category,
      variables,
      referencePhotos,
      poolPhotoIds,
      generatedFolderId,
    }: RegenerateInput) => {
      const formData = new FormData();
      formData.append("meta", JSON.stringify({ category, variables, poolPhotoIds, generatedFolderId }));
      // Every photo is appended under the same key — FormData supports
      // repeated keys natively, and the API route reads them all back with
      // formData.getAll("referencePhoto").
      referencePhotos?.forEach((photo) => {
        if (photo instanceof File) formData.append("referencePhoto", photo);
      });

      const res = await fetch("/api/products/regenerate", { method: "POST", body: formData });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "Regeneration failed.");
      }
      const data = (await res.json()) as { result: CategoryGenerationResult };
      return data.result;
    },
  });
}

interface RetryUploadInput {
  productId: string;
  productType: ProductType;
  photos: { front?: File | null; side?: File | null; worn?: File | null };
}

export function useRetryDriveUpload() {
  return useMutation({
    mutationFn: async ({ productId, productType, photos }: RetryUploadInput) => {
      const formData = new FormData();
      formData.append("productId", productId);
      formData.append("productType", productType);
      if (photos.front instanceof File) formData.append("frontPhoto", photos.front);
      if (photos.side instanceof File) formData.append("sidePhoto", photos.side);
      if (photos.worn instanceof File) formData.append("wornPhoto", photos.worn);

      const res = await fetch("/api/products/upload-originals", { method: "POST", body: formData });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "Upload failed.");
      }
      return (await res.json()) as { folders: ProductFolders | null; error: string | null };
    },
  });
}

// ── Copy (Milestone 7) ──────────────────────────────────────────────────

/**
 * Runs the full title -> description/tags/SEO chain (see
 * services/anthropic-copy.ts). This is what the Review screen's
 * "Generate Copy" button calls — never automatic, matching how Drive retry
 * and image Regenerate are also user-triggered.
 */
export function useGenerateAllCopy() {
  return useMutation({
    mutationFn: async ({ productId, variables }: { productId: string; variables: ImagePromptVariables }) => {
      const res = await fetch(`/api/products/${productId}/copy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ field: "all", variables }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "Copy generation failed.");
      }
      const data = (await res.json()) as { result: CopyGenerationResult };
      return data.result;
    },
  });
}

interface RegenerateCopyFieldInput {
  productId: string;
  field: "title" | "description" | "tags" | "seo";
  variables: ImagePromptVariables;
  /** The title currently on screen (approved or hand-edited) — required for every field but "title" itself. */
  title?: string;
}

/** Regenerates a single copy field on its own, reusing whatever title is currently on screen. */
export function useRegenerateCopyField() {
  return useMutation({
    mutationFn: async ({ productId, field, variables, title }: RegenerateCopyFieldInput) => {
      const res = await fetch(`/api/products/${productId}/copy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ field, variables, title }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "Regeneration failed.");
      }
      const data = (await res.json()) as {
        field: string;
        result: CopyFieldResult<string | string[] | { seoTitle: string; metaDescription: string }>;
      };
      return data.result;
    },
  });
}

interface SaveCopyInput extends ProductCopy {
  productId: string;
}

/** Saves approved (possibly hand-edited) copy to the product's Google Sheet row — what "Continue" calls. */
export function useSaveCopy() {
  return useMutation({
    mutationFn: async ({ productId, ...copy }: SaveCopyInput) => {
      const res = await fetch(`/api/products/${productId}/copy`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(copy),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "Couldn't save copy.");
      }
      return (await res.json()) as { ok: true };
    },
  });
}
