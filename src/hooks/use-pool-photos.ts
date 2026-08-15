"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ProductType } from "@/types/product";

export type PoolPhotoAngle = "front" | "side" | "worn" | "other";

export interface PoolPhoto {
  fileId: string;
  name: string;
  publicUrl: string;
  angle: PoolPhotoAngle;
  productType: ProductType | "";
  batchLabel: string;
  uploadedBy: string;
  notes: string;
  used: boolean;
  usedByProductId: string;
  createdTime: string;
}

export interface PoolPhotoFilters {
  angle?: PoolPhotoAngle;
  productType?: ProductType;
  unusedOnly?: boolean;
}

function poolQueryKey(filters: PoolPhotoFilters) {
  return ["pool-photos", filters] as const;
}

async function fetchPoolPhotos(filters: PoolPhotoFilters): Promise<PoolPhoto[]> {
  const params = new URLSearchParams();
  if (filters.angle) params.set("angle", filters.angle);
  if (filters.productType) params.set("productType", filters.productType);
  if (filters.unusedOnly) params.set("unusedOnly", "true");

  const res = await fetch(`/api/uploads?${params.toString()}`);
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error ?? "Couldn't load uploaded photos.");
  }
  const data = (await res.json()) as { photos: PoolPhoto[] };
  return data.photos;
}

/** The Uploads gallery and the Create Product "choose from Uploads" picker both use this. */
export function usePoolPhotos(filters: PoolPhotoFilters = {}) {
  return useQuery({
    queryKey: poolQueryKey(filters),
    queryFn: () => fetchPoolPhotos(filters),
  });
}

interface UploadPoolPhotosInput {
  files: File[];
  batchLabel: string;
  productType: ProductType | "";
  uploadedBy: string;
  notes: string;
}

export function useUploadPoolPhotos() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ files, batchLabel, productType, uploadedBy, notes }: UploadPoolPhotosInput) => {
      const formData = new FormData();
      formData.append("batchLabel", batchLabel);
      formData.append("productType", productType);
      formData.append("uploadedBy", uploadedBy);
      formData.append("notes", notes);
      files.forEach((file) => formData.append("photo", file));

      const res = await fetch("/api/uploads", { method: "POST", body: formData });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "Couldn't upload photos.");
      }
      const data = (await res.json()) as { photos: PoolPhoto[] };
      return data.photos;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pool-photos"] });
    },
  });
}

export function useTagPoolPhoto() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ fileId, angle }: { fileId: string; angle: PoolPhotoAngle }) => {
      const res = await fetch(`/api/uploads/${fileId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ angle }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "Couldn't update this photo's tag.");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pool-photos"] });
    },
  });
}
