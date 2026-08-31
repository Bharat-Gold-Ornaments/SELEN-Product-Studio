import { NextResponse } from "next/server";
import { z } from "zod";
import { saveProductVariants, retryVariantsSync } from "@/services/variants";

// Bumped from 60s: saving variants with a photo gallery now waits (up to
// ~25s, see waitForMediaReady in services/shopify.ts) for Shopify to finish
// processing newly-created media before it can be attached to a variant.
export const maxDuration = 90;

const variantRowSchema = z.object({
  id: z.string(),
  color: z.string(),
  size: z.string(),
  sameAsMainPrice: z.boolean(),
  grossWeightGrams: z.number().nonnegative(),
  netWeightGrams: z.number().nonnegative(),
  inventory: z.number().int().nonnegative(),
  useDefaultImages: z.boolean(),
});

const patchSchema = z.object({
  variants: z.array(variantRowSchema),
});

/**
 * Saves one product's variant rows — the Finalize screen's Variants panel.
 * Always persists to the Sheet; if the product is already published, also
 * pushes the change to Shopify immediately (this project's "sync on save"
 * decision — see services/variants.ts's doc comment, same as pricing).
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ productId: string }> }) {
  const { productId } = await params;

  const body = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request body." }, { status: 400 });
  }

  try {
    const result = await saveProductVariants(productId, parsed.data.variants);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Couldn't save variants." },
      { status: 400 }
    );
  }
}

/** Retries pushing a product's already-saved variants to Shopify — the "out of sync" badge's manual retry button. */
export async function POST(_request: Request, { params }: { params: Promise<{ productId: string }> }) {
  const { productId } = await params;

  try {
    const result = await retryVariantsSync(productId);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Couldn't sync to Shopify." },
      { status: 502 }
    );
  }
}
