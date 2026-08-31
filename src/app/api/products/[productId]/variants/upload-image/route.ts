import { NextResponse } from "next/server";
import { z } from "zod";
import { uploadVariantColorImage, removeVariantColorImage } from "@/services/variants";

export const maxDuration = 30;

const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const ACCEPTED_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];

/**
 * Manually adds one photo to a variant Color's gallery — the Variants
 * panel's escape hatch for when an AI-generated shot isn't good enough, or
 * simply to add more angles. See services/variants.ts's
 * uploadVariantColorImage.
 */
export async function POST(request: Request, { params }: { params: Promise<{ productId: string }> }) {
  const { productId } = await params;
  const formData = await request.formData();

  const color = formData.get("color");
  const file = formData.get("file");

  if (typeof color !== "string" || !color.trim()) {
    return NextResponse.json({ error: "Color is required." }, { status: 400 });
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "An image file is required." }, { status: 400 });
  }
  if (file.size > MAX_PHOTO_BYTES) {
    return NextResponse.json({ error: "Image must be under 10MB." }, { status: 400 });
  }
  if (!ACCEPTED_PHOTO_TYPES.includes(file.type)) {
    return NextResponse.json({ error: "Image must be a JPG, PNG, or WEBP." }, { status: 400 });
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await uploadVariantColorImage(productId, color, buffer, file.type || "image/jpeg");
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Couldn't upload the image." },
      { status: 400 }
    );
  }
}

const deleteSchema = z.object({
  color: z.string().min(1),
  imageId: z.string().min(1),
});

/** Removes one photo from a variant Color's gallery. See services/variants.ts's removeVariantColorImage. */
export async function DELETE(request: Request, { params }: { params: Promise<{ productId: string }> }) {
  const { productId } = await params;

  const body = await request.json().catch(() => null);
  const parsed = deleteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request body." }, { status: 400 });
  }

  try {
    const result = await removeVariantColorImage(productId, parsed.data.color, parsed.data.imageId);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Couldn't remove the image." },
      { status: 400 }
    );
  }
}
