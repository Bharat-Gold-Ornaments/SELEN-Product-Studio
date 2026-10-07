import { NextResponse } from "next/server";
import { InventorySkuConflictError, updateInventoryRow, type InventoryUpdate } from "@/services/google-sheets";
import { INVENTORY_CATEGORIES } from "@/lib/constants";
import type { InventoryCategory } from "@/types/inventory";

const VALID_CATEGORIES = new Set<string>(INVENTORY_CATEGORIES.map((c) => c.value));

/**
 * Edits an existing Inventory row. Every field is optional. Quantity may
 * drop to 0 here (sold out) even though a new item must start at 1 or more.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ sku: string }> }) {
  const { sku } = await params;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const update: InventoryUpdate = {};

  if (body.sku !== undefined) {
    const newSku = String(body.sku).trim();
    if (!newSku) {
      return NextResponse.json({ error: "SKU can't be empty." }, { status: 400 });
    }
    update.sku = newSku;
  }

  if (body.category !== undefined) {
    if (typeof body.category !== "string" || !VALID_CATEGORIES.has(body.category)) {
      return NextResponse.json({ error: "Pick a category: Rings, Pendants, Earrings or Chains." }, { status: 400 });
    }
    update.category = body.category as InventoryCategory;
  }
  if (body.weightGrams !== undefined) {
    const weight = Number(body.weightGrams);
    if (!Number.isFinite(weight) || weight <= 0) {
      return NextResponse.json({ error: "Weight must be a number greater than 0." }, { status: 400 });
    }
    update.weightGrams = weight;
  }
  if (body.shopifyProductId !== undefined) {
    update.shopifyProductId = String(body.shopifyProductId).trim();
  }
  if (body.quantity !== undefined) {
    const quantity = Number(body.quantity);
    if (!Number.isInteger(quantity) || quantity < 0) {
      return NextResponse.json({ error: "Quantity must be a whole number of 0 or more." }, { status: 400 });
    }
    update.quantity = quantity;
  }

  try {
    const item = await updateInventoryRow(sku, update);
    return NextResponse.json({ item });
  } catch (error) {
    console.error(`Failed to update inventory item ${sku}`, error);
    const message = error instanceof Error ? error.message : "Couldn't update this item.";
    const status =
      error instanceof InventorySkuConflictError ? 409 : message.startsWith("No inventory row") ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
