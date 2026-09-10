import { NextResponse } from "next/server";
import { z } from "zod";
import { removeDiscountFromScope } from "@/services/shopify";

export const maxDuration = 60;

const scopeSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("global") }),
  z.object({ type: z.literal("collection"), collectionId: z.string().min(1) }),
  z.object({ type: z.literal("tag"), tag: z.string().min(1) }),
]);

const bodySchema = z.object({ scope: scopeSchema });

/**
 * Discounts tab's "Remove Discount" — restores price from compareAtPrice and
 * clears compareAtPrice for every variant in scope that's currently
 * discounted. Variants with no compareAtPrice are left untouched.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request body." }, { status: 400 });
  }

  try {
    const result = await removeDiscountFromScope(parsed.data.scope);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Couldn't remove the discount." },
      { status: 502 }
    );
  }
}
