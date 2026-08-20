import { NextResponse } from "next/server";
import { z } from "zod";
import { findProduct } from "@/services/google-sheets";
import {
  ensureProductFolders,
  listFiles,
  uploadGenerated,
  deleteItem,
  driveFileIdFromImageProxyUrl,
} from "@/services/google-drive";
import { readImageDimensions } from "@/lib/image-dimensions";
import { IMAGE_CATEGORIES } from "@/lib/constants";
import type { ImageCategory } from "@/types/product";
import type { ProductFolders } from "@/services/google-drive";

export const maxDuration = 30;

const ACCEPTED_TYPES = new Set(["image/jpeg", "image/png"]);
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const IMAGE_CATEGORY_VALUES = [...IMAGE_CATEGORIES] as [ImageCategory, ...ImageCategory[]];
const categorySchema = z.enum(IMAGE_CATEGORY_VALUES);

function extensionFromMimeType(mimeType: string): string {
  return mimeType === "image/png" ? "png" : "jpg";
}

function manualFileNamePattern(category: ImageCategory): RegExp {
  return new RegExp(`^${category}-manual\\.[a-zA-Z0-9]+$`);
}

/**
 * Removes whichever manual-upload file(s) already exist for this category
 * before a new one lands — the manual slot holds exactly one photo at a
 * time (see review-client.tsx's design: AI regenerate replaces the AI
 * batch, a new manual upload replaces the previous manual upload the same
 * way). Matched by filename pattern rather than a stored id since the
 * extension can change between uploads (jpg one time, png the next),
 * which `uploadGenerated`'s find-by-exact-name overwrite wouldn't catch on
 * its own and would otherwise leave a stale file behind.
 */
async function clearExistingManualUpload(generatedFolderId: string, category: ImageCategory): Promise<void> {
  const files = await listFiles(generatedFolderId);
  const pattern = manualFileNamePattern(category);
  const stale = files.filter((file) => pattern.test(file.name));
  await Promise.all(
    stale.map((file) => deleteItem(driveFileIdFromImageProxyUrl(file.publicUrl)).catch(() => undefined))
  );
}

/**
 * Uploads a manually-supplied photo into the Review screen's "manual" slot
 * for one image category — the fallback for when Leonardo/Kie generation
 * doesn't produce an accurate result. Square-only and JPG/PNG-only,
 * enforced here (not just client-side) since this is a real upload
 * boundary. Lands in the same Drive `generated` folder AI candidates use,
 * under a fixed `{category}-manual.{ext}` name so the Review screen's
 * reload path (api/products/[productId]/review/route.ts) can tell manual
 * uploads apart from AI output by filename alone.
 */
export async function POST(request: Request, { params }: { params: Promise<{ productId: string }> }) {
  const { productId } = await params;

  const formData = await request.formData().catch(() => null);
  if (!formData) {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }

  const categoryResult = categorySchema.safeParse(formData.get("category"));
  const file = formData.get("file");
  if (!categoryResult.success || !(file instanceof File)) {
    return NextResponse.json({ error: "A category and an image file are required." }, { status: 400 });
  }
  const category = categoryResult.data;

  if (!ACCEPTED_TYPES.has(file.type)) {
    return NextResponse.json({ error: "Only JPG or PNG images are supported." }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "Image is too large (10MB max)." }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const dimensions = readImageDimensions(buffer, file.type);
  if (!dimensions) {
    return NextResponse.json({ error: "Couldn't read this image file." }, { status: 400 });
  }
  if (dimensions.width !== dimensions.height) {
    return NextResponse.json({ error: "Image must be square (equal width and height)." }, { status: 400 });
  }

  const lookup = await findProduct(productId).catch(() => null);
  if (!lookup) {
    return NextResponse.json({ error: "Product not found." }, { status: 404 });
  }

  let driveFolders: ProductFolders;
  try {
    driveFolders = await ensureProductFolders(lookup.record.category, productId);
    await clearExistingManualUpload(driveFolders.generatedFolderId, category);
    const uploaded = await uploadGenerated(
      driveFolders.generatedFolderId,
      `${category}-manual.${extensionFromMimeType(file.type)}`,
      buffer,
      file.type
    );
    return NextResponse.json({ imageUrl: uploaded.publicUrl, driveFolders });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Couldn't upload this image to Drive." },
      { status: 502 }
    );
  }
}

/**
 * Clears a category's manual upload — the Review screen's "remove" button
 * on that slot. Best-effort against Drive: if the product's folders don't
 * exist at all there's nothing to delete, which isn't an error from the
 * caller's point of view (the slot is already empty either way).
 */
export async function DELETE(request: Request, { params }: { params: Promise<{ productId: string }> }) {
  const { productId } = await params;

  const { searchParams } = new URL(request.url);
  const categoryResult = categorySchema.safeParse(searchParams.get("category"));
  if (!categoryResult.success) {
    return NextResponse.json({ error: "A category is required." }, { status: 400 });
  }

  const lookup = await findProduct(productId).catch(() => null);
  if (!lookup) {
    return NextResponse.json({ error: "Product not found." }, { status: 404 });
  }

  try {
    const driveFolders = await ensureProductFolders(lookup.record.category, productId);
    await clearExistingManualUpload(driveFolders.generatedFolderId, categoryResult.data);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Couldn't remove this image from Drive." },
      { status: 502 }
    );
  }
}
