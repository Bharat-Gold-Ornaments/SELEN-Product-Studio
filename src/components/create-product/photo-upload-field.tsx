"use client";

import { useEffect, useRef, useState, type DragEvent } from "react";
import Image from "next/image";
import { FolderOpen, ImagePlus, X } from "lucide-react";
import { cn } from "@/lib/utils";

/** A photo picked from the Uploads pool instead of the local filesystem. */
export interface PoolPhotoRef {
  fileId: string;
  publicUrl: string;
}

interface PhotoUploadFieldProps {
  id: string;
  label: string;
  value: File | null;
  onChange: (file: File | null) => void;
  error?: string;
  /** Set when this slot's photo came from Uploads instead of a local file — mutually exclusive with `value`. */
  poolPhoto?: PoolPhotoRef | null;
  /** Clears whichever pool photo is currently selected for this slot. */
  onClearPool?: () => void;
  /** Opens the "choose from Uploads" picker for this slot. Omit to hide the option entirely. */
  onOpenPicker?: () => void;
}

const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"];

export function PhotoUploadField({
  id,
  label,
  value,
  onChange,
  error,
  poolPhoto,
  onClearPool,
  onOpenPicker,
}: PhotoUploadFieldProps) {
  const [localPreviewUrl, setLocalPreviewUrl] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!value) {
      setLocalPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(value);
    setLocalPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [value]);

  // A pool selection always wins over a stale local preview — the parent
  // clears `value` when a pool photo is picked, but this keeps the two
  // preview sources unambiguous even for a stray render in between.
  const previewUrl = poolPhoto?.publicUrl ?? localPreviewUrl;

  function acceptFile(file: File | undefined) {
    if (!file) return;
    if (!ACCEPTED_TYPES.includes(file.type)) return;
    onClearPool?.();
    onChange(file);
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(false);
    acceptFile(e.dataTransfer.files?.[0]);
  }

  function clear() {
    onChange(null);
    onClearPool?.();
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-foreground">{label}</span>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => !previewUrl && inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && !previewUrl) inputRef.current?.click();
        }}
        className={cn(
          "relative flex aspect-square w-full cursor-pointer flex-col items-center justify-center gap-2 overflow-hidden rounded-xl border-2 border-dashed transition-colors",
          isDragging ? "border-primary bg-accent" : "border-border bg-secondary/40 hover:bg-secondary",
          error && "border-destructive"
        )}
      >
        {previewUrl ? (
          <>
            <Image src={previewUrl} alt={label} fill className="object-cover" unoptimized />
            {poolPhoto ? (
              <span className="absolute left-2 top-2 rounded-full bg-foreground/70 px-2 py-0.5 text-[10px] font-medium text-background">
                From Uploads
              </span>
            ) : null}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                clear();
              }}
              className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-foreground/70 text-background transition-colors hover:bg-destructive"
              aria-label={`Remove ${label}`}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </>
        ) : (
          <>
            <ImagePlus className="h-6 w-6 text-muted-foreground" />
            <span className="px-2 text-center text-xs text-muted-foreground">
              Drop or click to upload
            </span>
          </>
        )}
        <input
          ref={inputRef}
          id={id}
          type="file"
          accept={ACCEPTED_TYPES.join(",")}
          className="hidden"
          onChange={(e) => acceptFile(e.target.files?.[0])}
        />
      </div>
      {onOpenPicker ? (
        <button
          type="button"
          onClick={onOpenPicker}
          className="flex items-center justify-center gap-1.5 rounded-lg border border-input py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-secondary"
        >
          <FolderOpen className="h-3.5 w-3.5" />
          Choose from Uploads
        </button>
      ) : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
