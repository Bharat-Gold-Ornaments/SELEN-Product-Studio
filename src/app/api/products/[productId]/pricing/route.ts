import { NextResponse } from "next/server";
import { z } from "zod";
import { saveProductPricing, retryPriceSync } from "@/services/pricing";

export const maxDuration = 30;

const stoneLineItemSchema = z.object({
  id: z.string(),
  stoneType: z.string(),
  pricingMode: z.enum(["by_weight", "flat_per_piece"]),
  quantityOrWeight: z.number().nonnegative(),
  rate: z.number().nonnegative(),
});

const patchSchema = z.object({
  grossWeightGrams: z.number().positive("Gross weight must be greater than 0."),
  netWeightGrams: z.number().positive("Net weight must be greater than 0."),
  makingChargeMode: z.enum(["flat", "per_gram"]),
  makingChargeValue: z.number().nonnegative(),
  stoneLineItems: z.array(stoneLineItemSchema),
  manualPriceOverride: z.boolean(),
  manualPriceOverrideValue: z.number().positive().optional(),
});

/**
 * Saves one product's pricing fields (Gross/Net weight, making charge,
 * stone/pearl line items, manual override) — the Finalize screen's pricing
 * panel. Computes the final price via services/pricing.ts and, if the
 * product is already published, pushes it to Shopify immediately (this
 * project's "sync on save" decision — see that module's doc comment).
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ productId: string }> }) {
  const { productId } = await params;

  const body = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request body." }, { status: 400 });
  }

  try {
    const result = await saveProductPricing(productId, parsed.data);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Couldn't save pricing." },
      { status: 400 }
    );
  }
}

/** Retries pushing a product's already-saved price/weight to Shopify — the "out of sync" badge's manual retry button. */
export async function POST(_request: Request, { params }: { params: Promise<{ productId: string }> }) {
  const { productId } = await params;

  try {
    const result = await retryPriceSync(productId);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Couldn't sync to Shopify." },
      { status: 502 }
    );
  }
}
