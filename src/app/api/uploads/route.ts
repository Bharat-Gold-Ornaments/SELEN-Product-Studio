import { NextResponse } from "next/server";
import { uploadToPool, listPoolPhotos, type PoolPhotoAngle } from "@/services/google-drive";
import { PRODUCT_TYPES } from "@/lib/constants";
import type { ProductType } from "@/types/product";

const VALID_PRODUCT_TYPES = new Set(PRODUCT_TYPES.map((t) => t.value));
const VALID_ANGLES = new Set(["front", "side", "worn", "other"]);

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const angleParam = searchParams.get("angle");
  const productTypeParam = searchParams.get("productType");
  const unusedOnly = searchParams.get("unusedOnly") === "true";

  try {
    const photos = await listPoolPhotos({
      angle: angleParam && VALID_ANGLES.has(angleParam) ? (angleParam as PoolPhotoAngle) : undefined,
      productType:
        productTypeParam && VALID_PRODUCT_TYPES.has(productTypeParam as ProductType)
          ? (productTypeParam as ProductType)
          : undefined,
      unusedOnly,
    });
    return NextResponse.json({ photos });
  } catch (error) {
    console.error("Failed to list pool photos", error);
    const message = error instanceof Error ? error.message : "Couldn't load uploaded photos.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * Every photo in the request is uploaded with the same batch-level
 * metadata (batch label, product type, uploader) — the per-photo angle is
 * left unlabeled ("other") here and set afterward from the gallery, since
 * asking for it per-file at upload time (especially from a phone camera)
 * is more friction than it's worth.
 */
export async function POST(request: Request) {
  const formData = await request.formData();

  const batchLabel = (formData.get("batchLabel") as string | null)?.trim() || "Unlabeled batch";
  const productTypeRaw = (formData.get("productType") as string | null) ?? "";
  const productType = VALID_PRODUCT_TYPES.has(productTypeRaw as ProductType) ? productTypeRaw : "";
  const uploadedBy = (formData.get("uploadedBy") as string | null)?.trim() || "";
  const notes = (formData.get("notes") as string | null)?.trim() || "";

  const files = formData.getAll("photo").filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    return NextResponse.json({ error: "No photos were attached." }, { status: 400 });
  }

  try {
    const photos = await Promise.all(
      files.map(async (file) => {
        const buffer = Buffer.from(await file.arrayBuffer());
        return uploadToPool(file.name || `upload-${Date.now()}.jpg`, buffer, file.type || "image/jpeg", {
          angle: "other",
          productType: productType as ProductType | "",
          batchLabel,
          uploadedBy,
          notes,
        });
      })
    );
    return NextResponse.json({ photos });
  } catch (error) {
    console.error("Failed to upload pool photos", error);
    const message = error instanceof Error ? error.message : "Couldn't upload photos to Drive.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
