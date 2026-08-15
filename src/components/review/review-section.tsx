"use client";

import { useState } from "react";
import Image from "next/image";
import { AlertCircle, Check, Loader2, Maximize2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { CategoryGenerationResult } from "@/hooks/use-generation";

interface ReviewSectionProps {
  label: string;
  result: CategoryGenerationResult;
  selectedUrl: string | undefined;
  onSelect: (url: string) => void;
  onRegenerate: () => void;
  isRegenerating: boolean;
}

export function ReviewSection({
  label,
  result,
  selectedUrl,
  onSelect,
  onRegenerate,
  isRegenerating,
}: ReviewSectionProps) {
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

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
        ) : result.status === "error" ? (
          <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-destructive/30 bg-destructive/5 px-4 py-8 text-center">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <p className="max-w-sm text-xs text-destructive">{result.message}</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {result.imageUrls.map((url) => {
              const isSelected = selectedUrl === url;
              return (
                <div
                  key={url}
                  className={cn(
                    "group relative aspect-square overflow-hidden rounded-xl border-2 bg-muted transition-colors",
                    isSelected ? "border-primary" : "border-transparent hover:border-border"
                  )}
                >
                  <button
                    type="button"
                    onClick={() => onSelect(url)}
                    aria-pressed={isSelected}
                    className="absolute inset-0"
                  >
                    <Image src={url} alt={label} fill unoptimized className="object-cover" />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setLightboxUrl(url);
                    }}
                    aria-label={`View ${label} full size`}
                    className="absolute left-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-foreground/60 text-background opacity-0 transition-opacity hover:bg-foreground/80 focus-visible:opacity-100 group-hover:opacity-100"
                  >
                    <Maximize2 className="h-3.5 w-3.5" />
                  </button>
                  {isSelected ? (
                    <span className="pointer-events-none absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                      <Check className="h-3 w-3" />
                    </span>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>

      <Dialog open={Boolean(lightboxUrl)} onOpenChange={(open) => !open && setLightboxUrl(null)}>
        <DialogContent className="overflow-hidden rounded-2xl border border-border bg-card p-2 shadow-xl">
          <DialogTitle className="sr-only">{label} full size</DialogTitle>
          {lightboxUrl ? (
            // Generated images are always requested at a fixed square size
            // (see IMAGE_SIZE in services/leonardo.ts), so a square container
            // sized to the viewport is a safe fit without knowing the exact
            // pixel dimensions ahead of time.
            <div className="relative aspect-square w-[min(85vw,85vh)] overflow-hidden rounded-xl">
              <Image src={lightboxUrl} alt={label} fill unoptimized className="object-contain" />
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
