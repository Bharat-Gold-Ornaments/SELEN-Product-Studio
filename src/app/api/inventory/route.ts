import { NextResponse } from "next/server";
import { appendInventoryRow, listInventoryItems } from "@/services/google-sheets";
import { uploadInventoryPhoto } from "@/services/google-drive";
import { INVENTORY_CATEGORIES } from "@/lib/constants";
import type { InventoryCategory, InventoryItem } from "@/types/inventory";

const VALID_CATEGORIES = new Set<string>(INVENTORY_CATEGORIES.map((c) => c.value));

export async function GET() {
  try {
    const items = await listInventoryItems();
    return NextResponse.json({ items });
  } catch (error) {
    console.error("Failed to list inventory", error);
    const message = error instanceof Error ? error.message : "Couldn't load inventory.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * Multipart rather than JSON so the photo can travel in the same request —
 * it's uploaded to Drive first, and only its proxy URL lands in the Sheet.
 */
export async function POST(request: Request) {
  const formData = await request.formData();

  const sku = ((formData.get("sku") as string | null) ?? "").trim();
  const category = (formData.get("category") as string | null) ?? "";
  const weightGrams = Number(formData.get("weightGrams"));
  const quantity = Number(formData.get("quantity"));
  const shopifyProductId =((formData.get("shopifyProductId") as string | null) ?? "").trim();
  const photo = formData.get("photo");

  if (!sku) {
    return NextResponse.json({ error: "SKU is required." }, { status: 400 });
  }
  if (!VALID_CATEGORIES.has(category)) {
    return NextResponse.json({ error: "Pick a category: Rings, Pendants, Earrings or Chains." }, { status: 400 });
  }
  if (!Number.isFinite(weightGrams) || weightGrams <= 0) {
    return NextResponse.json({ error: "Weight must be a number greater than 0." }, { status: 400 });
  }

  if (!Number.isInteger(quantity) || quantity < 1) {
    return NextResponse.json({ error: "Quantity must be a whole number of 1 or more." }, { status: 400 });
  }

  try {
    const existing = await listInventoryItems();
    if (existing.some((item) => item.sku.toLowerCase() === sku.toLowerCase())) {
      return NextResponse.json({ error: `SKU "${sku}" is already in inventory.` }, { status: 409 });
    }

    let photoUrl = "";
    if (photo instanceof File && photo.size > 0) {
      photoUrl = (await uploadInventoryPhoto(sku, photo)).publicUrl;
    }

    const item: InventoryItem = {
      sku,
      category: category as InventoryCategory,
      weightGrams,
      quantity,
      photoUrl,
      shopifyProductId,
      createdDate: new Date().toISOString(),
    };
    await appendInventoryRow(item);
    return NextResponse.json({ item });
  } catch (error) {
    console.error("Failed to add inventory item", error);
    const message = error instanceof Error ? error.message : "Couldn't save this item.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
