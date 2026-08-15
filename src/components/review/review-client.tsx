"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
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
  useRetryDriveUpload,
  useSaveCopy,
  type GenerationSession,
  type ProductCopy,
} from "@/hooks/use-generation";
import type { ImageCategory } from "@/types/product";

export function ReviewClient({ productId }: { productId: string }) {
  const queryClient = useQueryClient();
  const [session, setSession] = useState<GenerationSession | undefined>(() =>
    getGenerationSession(queryClient, productId)
  );
  const [regeneratingCategory, setRegeneratingCategory] = useState<ImageCategory | null>(null);
  const regenerate = useRegenerateCategory();
  const retryUpload = useRetryDriveUpload();
  const saveCopy = useSaveCopy();

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

  const allSelected = useMemo(() => {
    if (!session) return false;
    return IMAGE_CATEGORIES.every((category) => {
      const result = session.imageResults.find((r) => r.category === category);
      return result?.status === "success" && Boolean(session.selected[category]);
    });
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
    setRegeneratingCategory(category);
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
        variables: session.variables,
        referencePhotos,
        poolPhotoIds: session.poolPhotoIds,
        generatedFolderId: session.driveFolders?.generatedFolderId ?? null,
      });
      setSession((prev) => {
        if (!prev) return prev;
        const imageResults = prev.imageResults.map((r) => (r.category === category ? result : r));
        const selected = { ...prev.selected };
        delete selected[category];
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
      setRegeneratingCategory(null);
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
      await saveCopy.mutateAsync({ productId, ...session.copy });
      queryClient.invalidateQueries({ queryKey: ["products-list"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-data"] });
      toast.success("Copy saved.", {
        description: "Finalize & Publish (Milestone 9) will pick up from here next.",
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't save copy.");
    }
  }

  return (
    <PageShell
      title="Review"
      description={`Product ${productId} — pick one image per category, or regenerate any that need another pass.`}
      actions={
        <Button
          onClick={handleContinue}
          disabled={!allSelected || !session.copy || saveCopy.isPending}
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
              isRegenerating={regeneratingCategory === category}
            />
          );
        })}
      </div>

      <CopySection
        productId={productId}
        variables={session.variables}
        copy={session.copy}
        onCopyChange={handleCopyChange}
      />
    </PageShell>
  );
}
