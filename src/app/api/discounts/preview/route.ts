import { NextResponse } from "next/server";
import { z } from "zod";
import { resolveScopeVariants } from "@/services/shopify";

const scopeSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("global") }),
  z.object({ type: z.literal("collection"), collectionId: z.string().min(1) }),
  z.object({ type: z.literal("tag"), tag: z.string().min(1) }),
]);

const bodySchema = z.object({ scope: scopeSchema });

/**
 * Discounts tab's live "Matches N products" line — read-only, called as the
 * merchant picks a scope, before they commit to an actual Apply/Remove.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request body." }, { status: 400 });
  }

  try {
    const products = await resolveScopeVariants(parsed.data.scope);
    const variantCount = products.reduce((sum, p) => sum + p.variants.length, 0);
    return NextResponse.json({
      productCount: products.length,
      variantCount,
      sampleTitles: products.slice(0, 5).map((p) => p.title),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Couldn't preview this scope." },
      { status: 502 }
    );
  }
}
