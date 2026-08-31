"use client";

import { useRef } from "react";
import { ImagePlus, Loader2, Plus, RefreshCw, Sparkles, TriangleAlert, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { VariantColorImage, VariantColorImageSet } from "@/lib/variants";

interface VariantColorPhotosCardProps {
  color: string;
  colorSet: VariantColorImageSet | undefined;
  isGenerating: boolean;
  isUploading: boolean;
  onGenerate: () => void;
  onUpload: (file: File) => void;
  onRemove: (imageId: string) => void;
}

function GalleryThumbnail({ image, onRemove }: { image: VariantColorImage; onRemove: () => void }) {
  return (
    <div className="group relative h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-border bg-muted">
      {/* Drive image-proxy URL — plain <img> rather than next/image, same
          reasoning as Finalize's own picked-image previews needing
          `unoptimized`, just without the extra wrapper for a thumbnail this
          small. */}
      <img src={image.url} alt={`${image.source} preview`} className="h-full w-full object-cover" />
      <button
        type="button"
        onClick={onRemove}
        aria-label="Remove photo"
        className="absolute right-0.5 top-0.5 rounded-full bg-background/80 p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
      >
        <X className="h-3 w-3" />
      </button>
      {image.source === "manual" ? (
        <span className="absolute bottom-0.5 left-0.5 rounded bg-background/80 px-1 text-[0.55rem] uppercase text-muted-foreground">
          Manual
        </span>
      ) : null}
    </div>
  );
}

function AddPhotoTile({ uploading, onPick }: { uploading: boolean; onPick: (file: File) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        aria-label="Add photo"
        className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg border border-dashed border-border text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
      >
        {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onPick(file);
          e.target.value = "";
        }}
      />
    </>
  );
}

/**
 * One card per distinct non-default variant Color (rendered by
 * VariantsPanel, one per color across all rows — not one per row, so two
 * Size rows sharing a Color share this one card/action). Shows the color's
 * open photo gallery — any number of photos, mixing AI-generated and
 * manually-uploaded, each individually removable — plus the one button that
 * (re)generates the 3 AI recolor shots.
 */
export function VariantColorPhotosCard({
  color,
  colorSet,
  isGenerating,
  isUploading,
  onGenerate,
  onUpload,
  onRemove,
}: VariantColorPhotosCardProps) {
  const status = isGenerating ? "generating" : colorSet?.status;
  const busy = status === "generating";
  const images = colorSet?.images ?? [];

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border px-3 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground">{color}</span>
          {status === "ready" ? (
            <Badge variant="success">Ready</Badge>
          ) : status === "generating" ? (
            <Badge variant="outline">Generating…</Badge>
          ) : status === "failed" ? (
            <Badge variant="warning">Failed</Badge>
          ) : (
            <Badge variant="outline">Not generated</Badge>
          )}
        </div>
        <Button variant="outline" size="sm" onClick={onGenerate} disabled={busy}>
          {busy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : images.length > 0 ? (
            <RefreshCw className="h-3.5 w-3.5" />
          ) : (
            <Sparkles className="h-3.5 w-3.5" />
          )}
          {images.length > 0 ? "Regenerate" : "Generate Photos"}
        </Button>
      </div>

      {status === "generating" ? null : (
        <div className="flex flex-wrap gap-2">
          {images.map((image) => (
            <GalleryThumbnail key={image.id} image={image} onRemove={() => onRemove(image.id)} />
          ))}
          <AddPhotoTile uploading={isUploading} onPick={onUpload} />
        </div>
      )}

      {status === "failed" && colorSet?.error ? (
        <p className="flex items-center gap-1.5 text-xs text-destructive">
          <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
          {colorSet.error} When adding by hand, preferably add them in Hero, Lifestyle, Closeup order.
        </p>
      ) : null}

      {images.length === 0 && status !== "generating" && status !== "failed" ? (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <ImagePlus className="h-3.5 w-3.5 shrink-0" />
          No photos yet — generate a recolor of the default shots, or add one by hand. When adding by hand,
          preferably add them in Hero, Lifestyle, Closeup order.
        </p>
      ) : null}

      {status === "ready" && colorSet?.usedTextToImageFallback ? (
        <p className="flex items-center gap-1.5 text-xs text-warning">
          <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
          This model doesn&apos;t support true image-to-image — these are a fresh reinterpretation, not an exact
          recolor of the default photos.
        </p>
      ) : null}
    </div>
  );
}
