"use client";

import Image from "next/image";
import { Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { usePoolPhotos, type PoolPhoto, type PoolPhotoAngle } from "@/hooks/use-pool-photos";
import type { ProductType } from "@/types/product";

interface PoolPhotoPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  angle: PoolPhotoAngle;
  productType: ProductType;
  onPick: (photo: PoolPhoto) => void;
}

/**
 * Filtered to this slot's angle and unused photos only — a photo already
 * claimed by another product shouldn't show up as pickable again. Not
 * filtered by product type as strictly (shown but not hidden), since a
 * photo uploaded before its product type was decided shouldn't become
 * invisible.
 */
export function PoolPhotoPicker({ open, onOpenChange, angle, productType, onPick }: PoolPhotoPickerProps) {
  const { data: photos, isLoading } = usePoolPhotos({ angle, unusedOnly: true });
  const sameType = photos?.filter((p) => !p.productType || p.productType === productType) ?? [];
  const otherType = photos?.filter((p) => p.productType && p.productType !== productType) ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] max-w-lg overflow-y-auto rounded-2xl border border-border bg-card p-4 shadow-xl">
        <DialogTitle>Choose a {angle} photo from Uploads</DialogTitle>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : sameType.length === 0 && otherType.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            No unused &quot;{angle}&quot; photos yet — upload some from the Uploads page first.
          </p>
        ) : (
          <div className="mt-3 flex flex-col gap-4">
            {sameType.length > 0 ? (
              <PickerGrid photos={sameType} onPick={onPick} />
            ) : null}
            {otherType.length > 0 ? (
              <div>
                <p className="mb-2 text-xs text-muted-foreground">Tagged for a different product type</p>
                <PickerGrid photos={otherType} onPick={onPick} />
              </div>
            ) : null}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function PickerGrid({ photos, onPick }: { photos: PoolPhoto[]; onPick: (photo: PoolPhoto) => void }) {
  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
      {photos.map((photo) => (
        <button
          key={photo.fileId}
          type="button"
          onClick={() => onPick(photo)}
          className="relative aspect-square overflow-hidden rounded-lg border-2 border-transparent transition-colors hover:border-primary"
        >
          <Image src={photo.publicUrl} alt={photo.name} fill unoptimized className="object-cover" />
        </button>
      ))}
    </div>
  );
}
