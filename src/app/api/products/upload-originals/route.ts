import { NextResponse } from "next/server";
import { z } from "zod";
import { uploadOriginalsToDrive, type OriginalPhoto } from "@/services/product-generation";
import { PRODUCT_TYPES } from "@/lib/constants";
import type { ProductType } from "@/types/product";

export const maxDuration = 60;

const PRODUCT_TYPE_VALUES = PRODUCT_TYPES.map((t) => t.value) as [ProductType, ...ProductType[]];

const metaSchema = z.object({
  productId: z.string().min(1),
  productType: z.enum(PRODUCT_TYPE_VALUES),
});

async function toOriginalPhoto(field: "front" | "side" | "worn", file: File): Promise<OriginalPhoto> {
  return {
    field,
    mimeType: file.type || "image/jpeg",
    buffer: Buffer.from(await file.arrayBuffer()),
  };
}

/**
 * Retries just the Drive folder + original-photo upload step, without
 * re-running Leonardo generation — used by the Review screen's "Retry
 * upload" action when the initial Drive step failed (e.g. credentials were
 * missing at the time, or Drive was briefly unreachable) but the images
 * generated fine and don't need to be redone.
 */
export async function POST(request: Request) {
  const formData = await request.formData();

  const meta = metaSchema.safeParse({
    productId: formData.get("productId"),
    productType: formData.get("productType"),
  });
  if (!meta.success) {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }

  // Every photo is optional — retry whichever ones were actually provided.
  const candidatePhotos: { field: "front" | "side" | "worn"; file: FormDataEntryValue | null }[] = [
    { field: "front", file: formData.get("frontPhoto") },
    { field: "side", file: formData.get("sidePhoto") },
    { field: "worn", file: formData.get("wornPhoto") },
  ];
  const providedPhotos = candidatePhotos.filter(
    (entry): entry is { field: "front" | "side" | "worn"; file: File } => entry.file instanceof File
  );

  const photos = await Promise.all(
    providedPhotos.map((entry) => toOriginalPhoto(entry.field, entry.file))
  );

  const outcome = await uploadOriginalsToDrive(meta.data.productType, meta.data.productId, photos);
  return NextResponse.json(outcome);
}
