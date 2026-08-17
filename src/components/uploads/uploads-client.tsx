"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { toast } from "sonner";
import { Camera, FolderOpen, Loader2, RefreshCw, RotateCcw, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { badgeVariants } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PRODUCT_TYPES, POOL_PHOTO_ANGLES } from "@/lib/constants";
import { cn } from "@/lib/utils";
import {
  usePoolPhotos,
  useUploadPoolPhotos,
  useTagPoolPhoto,
  useMarkPoolPhotoUnused,
  useDeletePoolPhoto,
  type PoolPhotoAngle,
} from "@/hooks/use-pool-photos";
import type { ProductType } from "@/types/product";

const ANGLE_LABEL = Object.fromEntries(POOL_PHOTO_ANGLES.map((a) => [a.value, a.label])) as Record<
  PoolPhotoAngle,
  string
>;

export function UploadsClient() {
  const [batchLabel, setBatchLabel] = useState(() => {
    const today = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" });
    return `${today} shoot`;
  });
  const [productType, setProductType] = useState<ProductType | "">("");
  const [uploadedBy, setUploadedBy] = useState("");
  const [notes, setNotes] = useState("");

  const cameraInputRef = useRef<HTMLInputElement>(null);
  const filesInputRef = useRef<HTMLInputElement>(null);

  const { data: photos, isLoading, isError, error, refetch, isFetching } = usePoolPhotos();
  const upload = useUploadPoolPhotos();
  const tag = useTagPoolPhoto();
  const markUnused = useMarkPoolPhotoUnused();
  const deletePhoto = useDeletePoolPhoto();

  function handleDelete(fileId: string, name: string) {
    if (!window.confirm(`Delete "${name}" from the pool? This can't be undone.`)) return;
    deletePhoto.mutate(fileId, {
      onError: (err) => toast.error(err instanceof Error ? err.message : "Couldn't delete this photo."),
    });
  }

  function handleMarkUnused(fileId: string) {
    markUnused.mutate(fileId, {
      onSuccess: () => toast.success("Photo is usable again"),
      onError: (err) => toast.error(err instanceof Error ? err.message : "Couldn't update this photo."),
    });
  }

  async function handleFilesPicked(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList);
    try {
      await upload.mutateAsync({ files, batchLabel, productType: productType, uploadedBy, notes });
      toast.success(`${files.length} photo${files.length > 1 ? "s" : ""} uploaded`, {
        description: "Tag each one's angle below so it's easy to find in Create Product.",
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed.");
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Batch details</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 pt-0 sm:grid-cols-3">
          <div>
            <Label htmlFor="batchLabel" className="mb-1.5 block text-sm font-normal">
              Batch label
            </Label>
            <Input id="batchLabel" value={batchLabel} onChange={(e) => setBatchLabel(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="poolProductType" className="mb-1.5 block text-sm font-normal">
              Product type
            </Label>
            <Select value={productType} onValueChange={(v) => setProductType(v as ProductType)}>
              <SelectTrigger id="poolProductType">
                <SelectValue placeholder="Not sure yet" />
              </SelectTrigger>
              <SelectContent>
                {PRODUCT_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="uploadedBy" className="mb-1.5 block text-sm font-normal">
              Uploaded by
            </Label>
            <Input id="uploadedBy" value={uploadedBy} onChange={(e) => setUploadedBy(e.target.value)} />
          </div>
          <div className="sm:col-span-3">
            <Label htmlFor="poolNotes" className="mb-1.5 block text-sm font-normal">
              Notes (optional)
            </Label>
            <Input
              id="poolNotes"
              placeholder='e.g. "emerald set, not the sample"'
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      <div className="rounded-2xl border border-dashed border-border px-4 py-8 text-center">
        <p className="text-sm text-muted-foreground">Applies to every photo you add below</p>
        <div className="mt-4 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Button type="button" onClick={() => cameraInputRef.current?.click()} disabled={upload.isPending}>
            {upload.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
            Take a photo
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => filesInputRef.current?.click()}
            disabled={upload.isPending}
          >
            <FolderOpen className="h-4 w-4" />
            Choose from files
          </Button>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Works from a phone browser too — no app install needed.
        </p>

        {/* Two separate inputs rather than one: `capture` locks mobile browsers
            into the camera only, so a plain input (no `capture`) is kept
            alongside it for picking existing photos from the gallery/files. */}
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          multiple
          className="hidden"
          onChange={(e) => {
            handleFilesPicked(e.target.files);
            e.target.value = "";
          }}
        />
        <input
          ref={filesInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            handleFilesPicked(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {isError ? (
        <div className="flex flex-col items-start justify-between gap-3 rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm sm:flex-row sm:items-center">
          <span className="text-destructive">
            {error instanceof Error ? error.message : "Couldn't load uploaded photos."}
          </span>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            {isFetching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Retry
          </Button>
        </div>
      ) : null}

      <div>
        <p className="mb-3 text-sm font-medium text-foreground">
          {isLoading ? "Loading photos…" : `${photos?.length ?? 0} photos in the pool`}
        </p>

        {isLoading ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="aspect-square w-full rounded-xl" />
            ))}
          </div>
        ) : photos && photos.length > 0 ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {photos.map((photo) => (
              <div key={photo.fileId} className="flex flex-col gap-2 rounded-xl border border-border bg-card p-2">
                <div className="relative aspect-square overflow-hidden rounded-lg bg-muted">
                  <Image src={photo.publicUrl} alt={photo.name} fill unoptimized className="object-cover" />
                  {photo.used ? (
                    <button
                      type="button"
                      onClick={() => handleMarkUnused(photo.fileId)}
                      disabled={markUnused.isPending}
                      title="Make usable again"
                      className={cn(
                        badgeVariants({ variant: "success" }),
                        "absolute right-1.5 top-1.5 transition-opacity hover:opacity-80 disabled:pointer-events-none disabled:opacity-50"
                      )}
                    >
                      <RotateCcw className="h-3 w-3" />
                      Used
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => handleDelete(photo.fileId, photo.name)}
                    disabled={deletePhoto.isPending}
                    aria-label={`Delete ${photo.name}`}
                    className="absolute left-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-foreground/60 text-background transition-colors hover:bg-destructive disabled:pointer-events-none disabled:opacity-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                <Select
                  value={photo.angle}
                  onValueChange={(value) => tag.mutate({ fileId: photo.fileId, angle: value as PoolPhotoAngle })}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue>{ANGLE_LABEL[photo.angle]}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {POOL_PHOTO_ANGLES.map((a) => (
                      <SelectItem key={a.value} value={a.value}>
                        {a.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="truncate text-[11px] text-muted-foreground" title={photo.batchLabel}>
                  {photo.batchLabel || "No batch label"}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex items-center justify-center rounded-2xl border border-dashed border-border py-16 text-sm text-muted-foreground">
            No photos uploaded yet — take or choose some above.
          </div>
        )}
      </div>
    </div>
  );
}
