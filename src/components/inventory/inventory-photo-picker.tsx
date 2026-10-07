"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { Camera, FolderOpen, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PhotoCropDialog } from "@/components/uploads/photo-crop-dialog";

interface InventoryPhotoPickerProps {
  /** A newly picked (and cropped) photo, not yet saved. */
  photo: File | null;
  /** The already-saved photo to show when no new one is picked. */
  savedUrl?: string;
  onSelect: (file: File) => void;
  onRemove: () => void;
}

/** Camera / file picker with crop step and preview — shared by the Add form and the Edit dialog. */
export function InventoryPhotoPicker({ photo, savedUrl, onSelect, onRemove }: InventoryPhotoPickerProps) {
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [cropQueue, setCropQueue] = useState<File[] | null>(null);

  const cameraInputRef = useRef<HTMLInputElement>(null);
  const filesInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!photo) {
      setPhotoPreview(null);
      return;
    }
    const url = URL.createObjectURL(photo);
    setPhotoPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  function handleFilePicked(fileList: FileList | null) {
    const file = fileList?.[0];
    if (file) setCropQueue([file]);
  }

  const previewUrl = photoPreview ?? savedUrl ?? null;

  return (
    <>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        {previewUrl ? (
          <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-lg border border-border bg-muted">
            <Image src={previewUrl} alt="Selected photo" fill unoptimized className="object-cover" />
            <button
              type="button"
              onClick={onRemove}
              aria-label="Remove photo"
              className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-foreground/60 text-background transition-colors hover:bg-destructive"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : null}
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button type="button" variant="outline" onClick={() => cameraInputRef.current?.click()}>
            <Camera className="h-4 w-4" />
            {previewUrl ? "Retake photo" : "Take a photo"}
          </Button>
          <Button type="button" variant="outline" onClick={() => filesInputRef.current?.click()}>
            <FolderOpen className="h-4 w-4" />
            Choose from files
          </Button>
        </div>
      </div>

      {/* Two inputs for the same reason as the Uploads page: `capture`
          locks mobile browsers into the camera, so a plain input is
          kept alongside it for picking an existing photo. */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          handleFilePicked(e.target.files);
          e.target.value = "";
        }}
      />
      <input
        ref={filesInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          handleFilePicked(e.target.files);
          e.target.value = "";
        }}
      />

      {cropQueue ? (
        <PhotoCropDialog
          files={cropQueue}
          onComplete={(files) => {
            setCropQueue(null);
            if (files[0]) onSelect(files[0]);
          }}
          onCancel={() => setCropQueue(null)}
        />
      ) : null}
    </>
  );
}
