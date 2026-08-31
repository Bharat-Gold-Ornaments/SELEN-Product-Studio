import { NextResponse } from "next/server";
import { z } from "zod";
import { generateVariantPhotos } from "@/services/variants";

// Matches api/products/regenerate/route.ts's ceiling — this is the same
// per-category generation cost, just run 3 times (Hero/Lifestyle/Closeup)
// instead of once.
export const maxDuration = 180;

const bodySchema = z.object({
  color: z.string().min(1, "Color is required"),
});

/**
 * AI-generates Hero/Lifestyle/Closeup photos for one variant Color — the
 * Variants panel's "Generate Photos" action. See services/variants.ts's
 * generateVariantPhotos for how this recolors the product's own default
 * photos rather than reinterpreting from scratch.
 */
export async function POST(request: Request, { params }: { params: Promise<{ productId: string }> }) {
  const { productId } = await params;

  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request body." }, { status: 400 });
  }

  try {
    const result = await generateVariantPhotos(productId, parsed.data.color);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Couldn't generate variant photos." },
      { status: 400 }
    );
  }
}
