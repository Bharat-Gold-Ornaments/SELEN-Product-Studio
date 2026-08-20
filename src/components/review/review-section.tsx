"use client";

import { useRef, useState, type DragEvent } from "react";
import Image from "next/image";
import { AlertCircle, Check, Loader2, Maximize2, RefreshCw, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { CategoryGenerationResult } from "@/hooks/use-generation";

const ACCEPTED_TYPES = ["image/jpeg", "image/png"];

interface ReviewSectionProps {
  label: string;
  result: CategoryGenerationResult;
  selectedUrl: string | undefined;
  onSelect: (url: string) => void;
  onRegenerate: () => void;
  isRegenerating: boolean;
  /** The category's manual-upload slot — see hooks/use-generation.ts's GenerationSession.manualUploads doc comment. */
  manualImageUrl?: string;
  onUpload: (file: File) => void;
  isUploading: boolean;
  onRemoveUpload: () => void;
}

/**
 * Client-side square + format check, run before the file ever leaves the
 * browser — the same rules are re-enforced server-side in
 * api/products/[productId]/upload-image/route.ts (this is a real upload
 * boundary, so the client check alone isn't trusted), but validating here
 * first means a bad file fails instantly instead of after a round trip.
 */
function validateImageFile(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    if (!ACCEPTED_TYPES.includes(file.type)) {
      resolve("Only JPG or PNG images are supported.");
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    // `window.Image` rather than bare `Image` — the latter resolves to the
    // `next/image` component imported above in this file's scope, not the
    // DOM constructor.
    const probe = new window.Image();
    probe.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(probe.naturalWidth === probe.naturalHeight ? null : "Image must be square (equal width and height).");
    };
    probe.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve("Couldn't read this image file.");
    };
    probe.src = objectUrl;
  });
}

export function ReviewSection({
  label,
  result,
  selectedUrl,
  onSelect,
  onRegenerate,
  isRegenerating,
  manualImageUrl,
  onUpload,
  isUploading,
  onRemoveUpload,
}: ReviewSectionProps) {
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setUploadError(null);
    const error = await validateImageFile(file);
    if (error) {
      setUploadError(error);
      return;
    }
    onUpload(file);
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle>{label}</CardTitle>
        <Button variant="outline" size="sm" onClick={onRegenerate} disabled={isRegenerating}>
          {isRegenerating ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          Regenerate
        </Button>
      </CardHeader>
      <CardContent className="pt-0">
        {isRegenerating ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="aspect-square w-full rounded-xl" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {result.status === "success"
              ? result.imageUrls.map((url) => (
                  <ImageTile
                    key={url}
                    url={url}
                    label={label}
                    badge="AI"
                    isSelected={selectedUrl === url}
                    onSelect={() => onSelect(url)}
                    onExpand={() => setLightboxUrl(url)}
                  />
                ))
              : null}

            {manualImageUrl ? (
              <ImageTile
                url={manualImageUrl}
                label={label}
                badge="Uploaded"
                isSelected={selectedUrl === manualImageUrl}
                onSelect={() => onSelect(manualImageUrl)}
                onExpand={() => setLightboxUrl(manualImageUrl)}
                onRemove={onRemoveUpload}
              />
            ) : (
              <div
                onDragOver={(e: DragEvent<HTMLDivElement>) => {
                  e.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(e: DragEvent<HTMLDivElement>) => {
                  e.preventDefault();
                  setIsDragging(false);
                  handleFile(e.dataTransfer.files?.[0]);
                }}
                onClick={() => !isUploading && inputRef.current?.click()}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if ((e.key === "Enter" || e.key === " ") && !isUploading) inputRef.current?.click();
                }}
                className={cn(
                  "relative flex aspect-square w-full cursor-pointer flex-col items-center justify-center gap-1.5 overflow-hidden rounded-xl border-2 border-dashed text-center transition-colors",
                  isDragging ? "border-primary bg-accent" : "border-border bg-secondary/40 hover:bg-secondary",
                  uploadError && "border-destructive"
                )}
              >
                {isUploading ? (
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                ) : (
                  <>
                    <Upload className="h-5 w-5 text-muted-foreground" />
                    <span className="px-2 text-[11px] text-muted-foreground">Upload your own photo</span>
                  </>
                )}
                <input
                  ref={inputRef}
                  type="file"
                  accept={ACCEPTED_TYPES.join(",")}
                  className="hidden"
                  onChange={(e) => handleFile(e.target.files?.[0])}
                />
              </div>
            )}
          </div>
        )}

        {result.status === "error" ? (
          <div className="mt-3 flex items-center gap-2 text-xs text-destructive">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            <span>{result.message}</span>
          </div>
        ) : null}
        {uploadError ? <p className="mt-3 text-xs text-destructive">{uploadError}</p> : null}
      </CardContent>

      <Dialog open={Boolean(lightboxUrl)} onOpenChange={(open) => !open && setLightboxUrl(null)}>
        <DialogContent className="overflow-hidden rounded-2xl border border-border bg-card p-2 shadow-xl">
          <DialogTitle className="sr-only">{label} full size</DialogTitle>
          {lightboxUrl ? (
            // Generated images are always requested at a fixed square size
            // (see IMAGE_SIZE in services/leonardo.ts) and manual uploads are
            // enforced square too, so a square container sized to the
            // viewport is a safe fit without knowing exact pixel dimensions.
            <div className="relative aspect-square w-[min(85vw,85vh)] overflow-hidden rounded-xl">
              <Image src={lightboxUrl} alt={label} fill unoptimized className="object-contain" />
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function ImageTile({
  url,
  label,
  badge,
  isSelected,
  onSelect,
  onExpand,
  onRemove,
}: {
  url: string;
  label: string;
  badge: "AI" | "Uploaded";
  isSelected: boolean;
  onSelect: () => void;
  onExpand: () => void;
  onRemove?: () => void;
}) {
  return (
    <div
      className={cn(
        "group relative aspect-square overflow-hidden rounded-xl border-2 bg-muted transition-colors",
        isSelected ? "border-primary" : "border-transparent hover:border-border"
      )}
    >
      <button type="button" onClick={onSelect} aria-pressed={isSelected} className="absolute inset-0">
        <Image src={url} alt={label} fill unoptimized className="object-cover" />
      </button>

      <span className="pointer-events-none absolute left-1.5 top-1.5 rounded-full bg-foreground/70 px-2 py-0.5 text-[10px] font-medium text-background">
        {badge}
      </span>

      {isSelected ? (
        <span className="pointer-events-none absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <Check className="h-3 w-3" />
        </span>
      ) : null}

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onExpand();
        }}
        aria-label={`View ${label} full size`}
        className="absolute bottom-1.5 left-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-foreground/60 text-background opacity-0 transition-opacity hover:bg-foreground/80 focus-visible:opacity-100 group-hover:opacity-100"
      >
        <Maximize2 className="h-3.5 w-3.5" />
      </button>

      {onRemove ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          aria-label={`Remove uploaded ${label}`}
          className="absolute bottom-1.5 right-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-foreground/60 text-background opacity-0 transition-opacity hover:bg-destructive focus-visible:opacity-100 group-hover:opacity-100"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </div>
  );
}
