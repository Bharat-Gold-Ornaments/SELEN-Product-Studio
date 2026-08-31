import { NextResponse } from "next/server";
import { z } from "zod";
import { listProducts, appendProductRow } from "@/services/google-sheets";
import { readAppSettings } from "@/services/app-settings";
import { buildImportedProductRecord, generateImportedProductId } from "@/lib/shopify-import";
import { PRODUCT_TYPES } from "@/lib/constants";
import type { ProductType } from "@/types/product";

export const maxDuration = 60;

const categoryValues = PRODUCT_TYPES.map((t) => t.value) as [ProductType, ...ProductType[]];

const candidateSchema = z.object({
  shopifyProductId: z.string().min(1),
  title: z.string().min(1),
  descriptionHtml: z.string(),
  tags: z.array(z.string()),
  productType: z.string(),
  createdAt: z.string(),
  seoTitle: z.string(),
  metaDescription: z.string(),
  imageUrls: z.array(z.string()),
  price: z.number(),
  inventory: z.number(),
  collections: z.array(z.string()),
  weightGrams: z.number().nullable(),
  stone: z.string().nullable(),
  finish: z.string().nullable(),
  widthCm: z.number().nullable(),
  lengthCm: z.number().nullable(),
});

const bodySchema = z.object({
  selections: z
    .array(
      z.object({
        candidate: candidateSchema,
        category: z.enum(categoryValues),
        /** Gross weight, entered per row on the import review screen — never inferred, since a manually-created Shopify product essentially never has this set anywhere this app could read it from. */
        grossWeightGrams: z.number().positive("Gross weight must be greater than 0."),
        /** Making Charge (₹/g), entered once for the whole batch on the review screen's confirm popup — sent per-selection so the server doesn't need special-cased "batch value" handling. */
        makingChargeValue: z.number().nonnegative(),
      })
    )
    .min(1, "Select at least one product to import."),
});

/**
 * Creates a Sheet row per selected Shopify product — the confirm step of
 * "Import from Shopify" (the review screen sends back exactly what GET
 * import-candidates gave it, plus the category/weight/making-charge the
 * user entered for each one). Price is recomputed here through the same
 * formula every other product uses (src/lib/pricing.ts), against the
 * current Rate/gram — never taken from Shopify's live price. Best-effort
 * per item, same pattern as services/pricing.ts's updateAllPrices: one row
 * failing to write doesn't abort the rest.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request body." }, { status: 400 });
  }
  const { selections } = parsed.data;

  let usedIds: Set<string>;
  let ratePerGram: number;
  try {
    const [existing, settings] = await Promise.all([listProducts(), readAppSettings()]);
    usedIds = new Set(existing.map((p) => p.productId));
    ratePerGram = settings.ratePerGram;
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Couldn't read existing products/settings." },
      { status: 502 }
    );
  }

  if (!(ratePerGram > 0)) {
    return NextResponse.json(
      { error: "No Rate/gram set yet — set it on Settings before importing." },
      { status: 400 }
    );
  }

  let imported = 0;
  const failed: { shopifyProductId: string; message: string }[] = [];

  for (const { candidate, category, grossWeightGrams, makingChargeValue } of selections) {
    try {
      const productId = generateImportedProductId(usedIds);
      const record = buildImportedProductRecord(productId, candidate, category, grossWeightGrams, ratePerGram, makingChargeValue);
      await appendProductRow(record);
      imported++;
    } catch (error) {
      failed.push({
        shopifyProductId: candidate.shopifyProductId,
        message: error instanceof Error ? error.message : "Unknown error.",
      });
    }
  }

  return NextResponse.json({ imported, failed });
}
