import { NextResponse } from "next/server";
import { InventorySkuConflictError, updateInventoryRow, type InventoryUpdate } from "@/services/google-sheets";
import { deleteItem, driveFileIdFromImageProxyUrl, uploadInventoryPhoto } from "@/services/google-drive";
import { INVENTORY_CATEGORIES } from "@/lib/constants";
import type { InventoryCategory } from "@/types/inventory";

const VALID_CATEGORIES = new Set<string>(INVENTORY_CATEGORIES.map((c) => c.value));

/** Best-effort — a leftover file in Drive isn't worth failing a save over. */
async function deletePhotoQuietly(photoUrl: string): Promise<void> {
  try {
    await deleteItem(driveFileIdFromImageProxyUrl(photoUrl));
  } catch (error) {
    console.error(`Couldn't delete inventory photo ${photoUrl}`, error);
  }
}

/**
 * Edits an existing Inventory row. Multipart (same as POST) so a new photo
 * can travel with the other fields. Every field is optional; send `photo` to
 * replace the photo or `removePhoto=true` to clear it. Quantity may drop to 0
 * here (sold out) even though a new item must start at 1 or more.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ sku: string }> }) {
  const { sku } = await params;
  const formData = await request.formData().catch(() => null);
  if (!formData) {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const field = (name: string) => {
    const value = formData.get(name);
    return typeof value === "string" ? value : undefined;
  };

  const update: InventoryUpdate = {};

  const newSku = field("sku");
  if (newSku !== undefined) {
    if (!newSku.trim()) {
      return NextResponse.json({ error: "SKU can't be empty." }, { status: 400 });
    }
    update.sku = newSku.trim();
  }

  const category = field("category");
  if (category !== undefined) {
    if (!VALID_CATEGORIES.has(category)) {
      return NextResponse.json({ error: "Pick a category: Rings, Pendants, Earrings or Chains." }, { status: 400 });
    }
    update.category = category as InventoryCategory;
  }

  const weightRaw = field("weightGrams");
  if (weightRaw !== undefined) {
    const weight = Number(weightRaw);
    if (!Number.isFinite(weight) || weight <= 0) {
      return NextResponse.json({ error: "Weight must be a number greater than 0." }, { status: 400 });
    }
    update.weightGrams = weight;
  }

  const shopifyProductId = field("shopifyProductId");
  if (shopifyProductId !== undefined) {
    update.shopifyProductId = shopifyProductId.trim();
  }

  const quantityRaw = field("quantity");
  if (quantityRaw !== undefined) {
    const quantity = Number(quantityRaw);
    if (!Number.isInteger(quantity) || quantity < 0) {
      return NextResponse.json({ error: "Quantity must be a whole number of 0 or more." }, { status: 400 });
    }
    update.quantity = quantity;
  }

  const photo = formData.get("photo");
  let uploadedPhotoUrl: string | null = null;

  try {
    if (photo instanceof File && photo.size > 0) {
      uploadedPhotoUrl = (await uploadInventoryPhoto(update.sku ?? sku, photo)).publicUrl;
      update.photoUrl = uploadedPhotoUrl;
    } else if (field("removePhoto") === "true") {
      update.photoUrl = "";
    }

    const { previous, item } = await updateInventoryRow(sku, update);
    if (previous.photoUrl && previous.photoUrl !== item.photoUrl) {
      await deletePhotoQuietly(previous.photoUrl);
    }
    return NextResponse.json({ item });
  } catch (error) {
    // The row wasn't saved, so a photo uploaded for it would be orphaned.
    if (uploadedPhotoUrl) await deletePhotoQuietly(uploadedPhotoUrl);
    console.error(`Failed to update inventory item ${sku}`, error);
    const message = error instanceof Error ? error.message : "Couldn't update this item.";
    const status =
      error instanceof InventorySkuConflictError ? 409 : message.startsWith("No inventory row") ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
