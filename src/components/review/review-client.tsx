"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, Loader2, RefreshCw, TriangleAlert } from "lucide-react";
import { PageShell } from "@/components/layout/page-shell";
import { Button } from "@/components/ui/button";
import { ReviewSection } from "@/components/review/review-section";
import { CopySection } from "@/components/review/copy-section";
import { IMAGE_CATEGORIES, IMAGE_CATEGORY_LABELS } from "@/lib/constants";
import {
  getGenerationSession,
  setGenerationSession,
  useProductReview,
  useRegenerateCategory,
  useRemoveCustomImage,
  useRetryDriveUpload,
  useSaveCopy,
  useUploadCustomImage,
  type CategoryGenerationResult,
  type GenerationSession,
  type ProductCopy,
} from "@/hooks/use-generation";
import type { ImageCategory } from "@/types/product";

// Picks the first successfully-generated image for a category — used as a
// fallback for CopySection's vision inputs when nothing's been explicitly
// selected yet on Review. A plain `.find(...)?.imageUrls[0]` doesn't narrow
// through TypeScript's union (CategoryGenerationResult's "error" variant has
// no imageUrls), so the status check happens here instead.
function firstSuccessfulImageUrl(results: CategoryGenerationResult[], category: ImageCategory): string | undefined {
  for (const result of results) {
    if (result.category === category && result.status === "success") {
      return result.imageUrls[0];
    }
  }
  return undefined;
}

export function ReviewClient({ productId }: { productId: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [session, setSession] = useState<GenerationSession | undefined>(() =>
    getGenerationSession(queryClient, productId)
  );
  // Sets, not a single category — each of Hero/Lifestyle/Closeup can be
  // regenerating/uploading independently. A single shared value here used to
  // mean clicking Regenerate on a second category while the first was still
  // in flight would immediately clear the first card's loading state (and
  // its `finally` block would later clear the second's), making the first
  // regenerate look like it silently failed even though its request was
  // still running server-side and its result still landed correctly.
  const [regeneratingCategories, setRegeneratingCategories] = useState<Set<ImageCategory>>(() => new Set());
  const [uploadingCategories, setUploadingCategories] = useState<Set<ImageCategory>>(() => new Set());
  const regenerate = useRegenerateCategory();
  const retryUpload = useRetryDriveUpload();
  const saveCopy = useSaveCopy();
  const uploadCustomImage = useUploadCustomImage();
  const removeCustomImage = useRemoveCustomImage();

  // No in-memory session (fresh page load, refresh, or navigated here from
  // the Products list rather than straight from Generate) — reload this
  // product's already-generated images from Sheets + Drive instead of
  // treating it as an error. See hooks/use-generation.ts.
  const reviewQuery = useProductReview(productId, session === undefined);
  useEffect(() => {
    if (!session && reviewQuery.data) {
      setSession(reviewQuery.data);
    }
  }, [session, reviewQuery.data]);

  // At least one category picked is enough to continue — not every category
  // needs an image. A category left unpicked (or whose generation failed)
  // just doesn't get sent to Shopify later; see handleContinue below, where
  // an unselected category's link is naturally omitted rather than forced.
  // `selected[category]` is only ever set to a real image URL (from an AI
  // candidate or a manual upload), so checking it alone is enough — no need
  // to separately require the AI batch to have succeeded, since a manual
  // upload can carry a category on its own even when AI generation failed.
  const hasSelection = useMemo(() => {
    if (!session) return false;
    return IMAGE_CATEGORIES.some((category) => Boolean(session.selected[category]));
  }, [session]);

  if (!session) {
    if (reviewQuery.isLoading) {
      return (
        <PageShell title="Review">
          <div className="flex flex-1 items-center justify-center py-16">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        </PageShell>
      );
    }

    return (
      <PageShell title="Review">
        <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border py-16 text-center">
          <TriangleAlert className="h-5 w-5 text-muted-foreground" />
          <p className="text-sm text-foreground">
            {reviewQuery.error instanceof Error
              ? reviewQuery.error.message
              : "This review session has expired."}
          </p>
          <p className="max-w-sm text-xs text-muted-foreground">
            {reviewQuery.error
              ? "Couldn't reload this product's generated images."
              : "Start the product again from Create Product."}
          </p>
          <Button asChild variant="outline" size="sm" className="mt-2">
            <Link href="/products/create">
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to Create Product
            </Link>
          </Button>
        </div>
      </PageShell>
    );
  }

  function addCategory(setter: typeof setRegeneratingCategories, category: ImageCategory) {
    setter((prev) => new Set(prev).add(category));
  }

  function removeCategory(setter: typeof setRegeneratingCategories, category: ImageCategory) {
    setter((prev) => {
      if (!prev.has(category)) return prev;
      const next = new Set(prev);
      next.delete(category);
      return next;
    });
  }

  function selectImage(category: ImageCategory, url: string) {
    setSession((prev) => {
      if (!prev) return prev;
      const next = { ...prev, selected: { ...prev.selected, [category]: url } };
      setGenerationSession(queryClient, productId, next);
      return next;
    });
  }

  async function handleRegenerate(category: ImageCategory) {
    if (!session) return;
    addCategory(setRegeneratingCategories, category);
    try {
      // Resend every reference photo the initial generation used (front,
      // side, worn — whichever were actually provided) so the regenerated
      // image stays visually consistent via image-to-image, rather than
      // silently reverting to text-to-image or dropping down to just one
      // angle of the piece.
      const referencePhotos = [
        session.originalPhotos.front,
        session.originalPhotos.side,
        session.originalPhotos.worn,
      ];
      const result = await regenerate.mutateAsync({
        productId,
        category,
        productType: session.productType,
        variables: session.variables,
        referencePhotos,
        poolPhotoIds: session.poolPhotoIds,
        generatedFolderId: session.driveFolders?.generatedFolderId ?? null,
        originalsFolderId: session.driveFolders?.originalsFolderId ?? null,
      });
      setSession((prev) => {
        if (!prev) return prev;
        const imageResults = prev.imageResults.map((r) => (r.category === category ? result : r));
        const selected = { ...prev.selected };
        // Only clear the selection if it pointed at one of the AI candidates
        // that Regenerate just replaced — if the manual upload was selected
        // instead, it's untouched by Regenerate and should stay selected.
        if (selected[category] !== prev.manualUploads[category]) {
          delete selected[category];
        }
        const next = { ...prev, imageResults, selected };
        setGenerationSession(queryClient, productId, next);
        return next;
      });
      if (result.status === "success") {
        toast.success(`${IMAGE_CATEGORY_LABELS[category]} regenerated`);
      } else {
        toast.error(result.message);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Regeneration failed.");
    } finally {
      removeCategory(setRegeneratingCategories, category);
    }
  }

  async function handleUpload(category: ImageCategory, file: File) {
    addCategory(setUploadingCategories, category);
    try {
      const outcome = await uploadCustomImage.mutateAsync({ productId, category, file });
      setSession((prev) => {
        if (!prev) return prev;
        // A manual upload always wins the slot it just filled — same
        // "replace, don't append" rule Regenerate follows for the AI batch.
        const next = {
          ...prev,
          manualUploads: { ...prev.manualUploads, [category]: outcome.imageUrl },
          selected: { ...prev.selected, [category]: outcome.imageUrl },
          // Drive folders may have just been created for the first time if
          // this product's initial upload had failed earlier — pick up the
          // real ids/clear the stale error so the rest of Review (and a
          // later Continue) sees them too.
          driveFolders: outcome.driveFolders,
          driveError: null,
        };
        setGenerationSession(queryClient, productId, next);
        return next;
      });
      toast.success(`${IMAGE_CATEGORY_LABELS[category]} photo uploaded`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Upload failed.");
    } finally {
      removeCategory(setUploadingCategories, category);
    }
  }

  async function handleRemoveUpload(category: ImageCategory) {
    if (!session) return;
    const removedUrl = session.manualUploads[category];
    try {
      await removeCustomImage.mutateAsync({ productId, category });
      setSession((prev) => {
        if (!prev) return prev;
        const manualUploads = { ...prev.manualUploads };
        delete manualUploads[category];
        const selected = { ...prev.selected };
        // Only clear the selection if it was pointing at the upload that
        // just got removed — leave an AI selection (or no selection) alone.
        if (removedUrl && selected[category] === removedUrl) {
          delete selected[category];
        }
        const next = { ...prev, manualUploads, selected };
        setGenerationSession(queryClient, productId, next);
        return next;
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't remove the uploaded photo.");
    }
  }

  async function handleRetryUpload() {
    if (!session) return;
    try {
      const outcome = await retryUpload.mutateAsync({
        productId,
        productType: session.productType,
        photos: session.originalPhotos,
      });
      setSession((prev) => {
        if (!prev) return prev;
        const next = { ...prev, driveFolders: outcome.folders, driveError: outcome.error };
        setGenerationSession(queryClient, productId, next);
        return next;
      });
      if (outcome.error) {
        toast.error(outcome.error);
      } else {
        toast.success("Originals uploaded to Drive");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Upload failed.");
    }
  }

  function handleCopyChange(copy: ProductCopy) {
    setSession((prev) => {
      if (!prev) return prev;
      const next = { ...prev, copy };
      setGenerationSession(queryClient, productId, next);
      return next;
    });
  }

  async function handleContinue() {
    if (!session?.copy) return;
    try {
      await saveCopy.mutateAsync({
        productId,
        ...session.copy,
        // Only whichever categories actually got a pick — session.selected
        // simply has no key for a skipped/unpicked category, and that
        // `undefined` is what tells the PATCH route to leave it out rather
        // than send an empty placeholder. See that route's schema comment.
        heroImageLink: session.selected.hero,
        lifestyleImageLink: session.selected.lifestyle,
        closeupImageLink: session.selected.closeup,
      });
      queryClient.invalidateQueries({ queryKey: ["products-list"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-data"] });
      router.push(`/products/${productId}/finalize`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't save copy.");
    }
  }

  return (
    <PageShell
      title="Review"
      description={`Product ${productId} — pick at least one image to continue, or regenerate any that need another pass.`}
      actions={
        <Button
          onClick={handleContinue}
          disabled={!hasSelection || !session.copy || saveCopy.isPending}
        >
          {saveCopy.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Continue
          <ArrowRight className="h-4 w-4" />
        </Button>
      }
    >
      {session.driveError ? (
        <div className="flex flex-col items-start justify-between gap-3 rounded-2xl border border-warning/30 bg-warning/5 px-4 py-3 text-sm sm:flex-row sm:items-center">
          <span className="text-warning">Couldn&apos;t upload originals to Drive: {session.driveError}</span>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRetryUpload}
            disabled={retryUpload.isPending}
          >
            {retryUpload.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            Retry upload
          </Button>
        </div>
      ) : null}

      {session.sheetsError ? (
        <div className="rounded-2xl border border-warning/30 bg-warning/5 px-4 py-3 text-sm">
          <span className="text-warning">
            Couldn&apos;t save this product to Google Sheets: {session.sheetsError}. Images above are
            unaffected, but this product won&apos;t appear on the dashboard or Products list until it&apos;s
            fixed and regenerated.
          </span>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {IMAGE_CATEGORIES.map((category) => {
          const result = session.imageResults.find((r) => r.category === category);
          if (!result) return null;
          return (
            <ReviewSection
              key={category}
              label={IMAGE_CATEGORY_LABELS[category]}
              result={result}
              selectedUrl={session.selected[category]}
              onSelect={(url) => selectImage(category, url)}
              onRegenerate={() => handleRegenerate(category)}
              isRegenerating={regeneratingCategories.has(category)}
              manualImageUrl={session.manualUploads[category]}
              onUpload={(file) => handleUpload(category, file)}
              isUploading={uploadingCategories.has(category)}
              onRemoveUpload={() => handleRemoveUpload(category)}
            />
          );
        })}
      </div>

      <CopySection
        productId={productId}
        variables={session.variables}
        copy={session.copy}
        onCopyChange={handleCopyChange}
        heroImageUrl={session.selected.hero ?? firstSuccessfulImageUrl(session.imageResults, "hero") ?? session.manualUploads.hero}
        lifestyleImageUrl={
          session.selected.lifestyle ??
          firstSuccessfulImageUrl(session.imageResults, "lifestyle") ??
          session.manualUploads.lifestyle
        }
      />
    </PageShell>
  );
}
