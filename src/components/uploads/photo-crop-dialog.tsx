"use client";

import { useCallback, useEffect, useState } from "react";
import Cropper, { type Area } from "react-easy-crop";
import { Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getCroppedImageFile } from "@/lib/crop-image";

const ASPECT_OPTIONS: { label: string; value: number | null }[] = [
  { label: "Original", value: null },
  { label: "Square", value: 1 },
  { label: "Portrait", value: 4 / 5 },
];

interface PhotoCropDialogProps {
  /** Files queued for cropping, one at a time, in order. */
  files: File[];
  /** Called once every file has been either cropped or skipped. */
  onComplete: (files: File[]) => void;
  /** Called if the user backs out — no files from this batch are uploaded. */
  onCancel: () => void;
}

export function PhotoCropDialog({ files, onComplete, onCancel }: PhotoCropDialogProps) {
  const [index, setIndex] = useState(0);
  const [processedFiles, setProcessedFiles] = useState<File[]>([]);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [naturalAspect, setNaturalAspect] = useState(1);
  const [aspect, setAspect] = useState<number | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const currentFile = files[index];

  useEffect(() => {
    if (!currentFile) return;
    const url = URL.createObjectURL(currentFile);
    setImageUrl(url);
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setAspect(null);
    setCroppedAreaPixels(null);

    const img = new window.Image();
    img.onload = () => setNaturalAspect(img.naturalWidth / img.naturalHeight || 1);
    img.src = url;

    return () => URL.revokeObjectURL(url);
  }, [currentFile]);

  const onCropComplete = useCallback((_croppedArea: Area, areaPixels: Area) => {
    setCroppedAreaPixels(areaPixels);
  }, []);

  function advance(file: File) {
    const next = [...processedFiles, file];
    if (index + 1 >= files.length) {
      onComplete(next);
    } else {
      setProcessedFiles(next);
      setIndex(index + 1);
    }
  }

  async function handleUseCrop() {
    if (!currentFile || !imageUrl || !croppedAreaPixels) return;
    setIsProcessing(true);
    try {
      const cropped = await getCroppedImageFile(
        imageUrl,
        croppedAreaPixels,
        currentFile.name,
        currentFile.type || "image/jpeg"
      );
      advance(cropped);
    } catch {
      advance(currentFile);
    } finally {
      setIsProcessing(false);
    }
  }

  function handleSkip() {
    if (!currentFile) return;
    advance(currentFile);
  }

  if (!currentFile) return null;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <DialogContent className="w-[calc(100vw-2rem)] max-w-lg rounded-2xl border border-border bg-card p-4 shadow-xl">
        <DialogTitle>Crop photo{files.length > 1 ? ` (${index + 1} of ${files.length})` : ""}</DialogTitle>

        <div className="relative mt-3 h-80 w-full overflow-hidden rounded-xl bg-muted">
          {imageUrl ? (
            <Cropper
              image={imageUrl}
              crop={crop}
              zoom={zoom}
              aspect={aspect ?? naturalAspect}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={onCropComplete}
            />
          ) : null}
        </div>

        <div className="mt-3 flex items-center justify-center gap-2">
          {ASPECT_OPTIONS.map((opt) => (
            <button
              key={opt.label}
              type="button"
              onClick={() => {
                setAspect(opt.value);
                setCrop({ x: 0, y: 0 });
                setZoom(1);
              }}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                opt.value === aspect
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-input text-foreground hover:bg-secondary"
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <input
          type="range"
          min={1}
          max={3}
          step={0.01}
          value={zoom}
          onChange={(e) => setZoom(Number(e.target.value))}
          className="mt-3 w-full accent-primary"
          aria-label="Zoom"
        />

        <div className="mt-4 flex items-center justify-between gap-2">
          <Button type="button" variant="ghost" onClick={onCancel} disabled={isProcessing}>
            Cancel all
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={handleSkip} disabled={isProcessing}>
              Skip crop
            </Button>
            <Button type="button" onClick={handleUseCrop} disabled={isProcessing || !croppedAreaPixels}>
              {isProcessing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {index + 1 >= files.length ? "Use photo" : "Use & next"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
