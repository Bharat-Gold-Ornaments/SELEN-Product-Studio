import { NextResponse } from "next/server";
import { z } from "zod";
import { applyDiscountToScope } from "@/services/shopify";

export const maxDuration = 60;

const scopeSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("global") }),
  z.object({ type: z.literal("collection"), collectionId: z.string().min(1) }),
  z.object({ type: z.literal("tag"), tag: z.string().min(1) }),
]);

const bodySchema = z.object({
  scope: scopeSchema,
  percent: z.number().min(1, "Discount must be at least 1%.").max(90, "Discount can't exceed 90%."),
});

/**
 * Discounts tab's "Apply Discount" — the confirmation dialog itself lives in
 * the UI; by the time this route runs, the merchant has already confirmed
 * the scope and percentage. Pushes real price/compareAtPrice changes to
 * Shopify immediately (see services/shopify.ts's applyDiscountToScope).
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request body." }, { status: 400 });
  }

  try {
    const result = await applyDiscountToScope(parsed.data.scope, parsed.data.percent);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Couldn't apply the discount." },
      { status: 502 }
    );
  }
}
