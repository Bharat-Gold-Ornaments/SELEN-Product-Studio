import { NextResponse } from "next/server";
import { z } from "zod";
import { saveProductInventory, retryInventorySync } from "@/services/inventory";

export const maxDuration = 30;

const patchSchema = z.object({
  inventory: z.number().int().nonnegative("Inventory can't be negative."),
});

/**
 * Saves Finalize's plain (no-variants) Inventory field and, if the product
 * is already published, pushes it to Shopify immediately (this project's
 * "sync on save" decision — see services/inventory.ts's doc comment).
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ productId: string }> }) {
  const { productId } = await params;

  const body = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request body." }, { status: 400 });
  }

  try {
    const result = await saveProductInventory(productId, parsed.data.inventory);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Couldn't save inventory." },
      { status: 400 }
    );
  }
}

/** Retries pushing a product's already-saved inventory to Shopify — the "out of sync" badge's manual retry button. */
export async function POST(_request: Request, { params }: { params: Promise<{ productId: string }> }) {
  const { productId } = await params;

  try {
    const result = await retryInventorySync(productId);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Couldn't sync to Shopify." },
      { status: 502 }
    );
  }
}
