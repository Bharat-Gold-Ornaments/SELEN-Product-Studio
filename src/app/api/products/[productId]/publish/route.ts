import { NextResponse } from "next/server";
import { z } from "zod";
import { findProduct, updateProductRow } from "@/services/google-sheets";
import { publishProductToShopify } from "@/services/shopify";
import { readAppSettings } from "@/services/app-settings";
import { PRODUCT_TYPES } from "@/lib/constants";
import { descriptionToHtml, loadPickedShopifyImages, loadVariantColorShopifyImages } from "@/lib/shopify-listing";
import { parseVariantRows, resolveVariantPrice, parseVariantColorImages, colorsNeedingGeneratedImages } from "@/lib/variants";
import { parseStoneLineItems } from "@/lib/pricing";

export const maxDuration = 90;

const bodySchema = z.object({
  price: z.number().positive("Price must be greater than 0."),
  inventory: z.number().int().nonnegative("Inventory can't be negative."),
});

/**
 * Publishes a finalized product to Shopify — the Finalize screen's "Publish"
 * button. Requires Review's Continue to have already run (needs a saved
 * title/description/tags/SEO and at least one image pick — Review lets a
 * category go unpicked, so this can't demand all three); price/inventory
 * come from this request since Finalize is where those are actually set.
 * Downloads whichever picked images' real bytes from Drive (never a public
 * URL — see driveFileIdFromImageProxyUrl's doc comment) and hands
 * everything to services/shopify.ts in one call.
 */
export async function POST(request: Request, { params }: { params: Promise<{ productId: string }> }) {
  const { productId } = await params;

  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request body." }, { status: 400 });
  }
  const { price, inventory } = parsed.data;

  const lookup = await findProduct(productId).catch(() => null);
  if (!lookup) {
    return NextResponse.json({ error: "Product not found." }, { status: 404 });
  }
  const { record } = lookup;

  if (!record.description.trim()) {
    return NextResponse.json(
      { error: "Save copy on Review before publishing — this product has none yet." },
      { status: 400 }
    );
  }

  // Checked here, before flipping status to "publishing" below, so a
  // product with no picked images fails fast with a plain 400 rather than
  // briefly flipping to "publishing" and then "failed" over what's really a
  // validation problem, not a Shopify/Drive failure.
  if (!record.heroImageLink && !record.lifestyleImageLink && !record.closeupImageLink) {
    return NextResponse.json(
      { error: "This product has no picked images — pick at least one image on Review before publishing." },
      { status: 400 }
    );
  }

  // Persist the finalized price/inventory and flip to "publishing" before
  // doing any Shopify work — if this fails there's no point continuing
  // (nowhere to record the outcome), so it's the one step allowed to bail
  // out early rather than falling into the catch-and-mark-failed block
  // below.
  try {
    await updateProductRow(productId, { price, inventory, status: "publishing" });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Couldn't save price/inventory to Google Sheets." },
      { status: 502 }
    );
  }

  try {
    const productType = PRODUCT_TYPES.find((t) => t.value === record.category)?.label ?? record.category;
    // Variants are saved independently via the Variants panel before Publish
    // ever runs (same as Pricing) — read whatever's currently saved rather
    // than taking them from this request's body. "Same as main price" rows
    // resolve against this request's `price` so they can never go stale
    // relative to whatever price is actually being sent; a custom-weight row
    // is recomputed fresh with the current global rate.
    const variantRows = parseVariantRows(record.variants);
    const settings = await readAppSettings();
    const pricing = {
      ratePerGram: settings.ratePerGram,
      makingChargeMode: record.makingChargeMode,
      makingChargeValue: record.makingChargeValue,
      stoneLineItems: parseStoneLineItems(record.stoneLineItems),
    };
    const variants = variantRows.map((row) => ({
      color: row.color,
      size: row.size,
      price: resolveVariantPrice(row, price, pricing),
      inventory: row.inventory,
      useDefaultImages: row.useDefaultImages,
      grossWeightGrams: row.grossWeightGrams,
    }));

    const [baseImages, colorImages] = await Promise.all([
      loadPickedShopifyImages(record),
      loadVariantColorShopifyImages(
        parseVariantColorImages(record.variantColorImages),
        colorsNeedingGeneratedImages(variantRows, record.finish)
      ),
    ]);
    const images = [...baseImages, ...colorImages];

    const result = await publishProductToShopify({
      title: record.title,
      descriptionHtml: descriptionToHtml(record.description),
      tags: record.tags,
      productType,
      price,
      inventory,
      images,
      variants,
      seoTitle: record.seoTitle || record.title,
      metaDescription: record.metaDescription,
      weightGrams: record.weightGrams,
      stone: record.stone,
      finish: record.finish,
      widthCm: record.widthCm,
      lengthCm: record.lengthCm,
      collections: record.collections,
    });

    await updateProductRow(productId, { status: "published", shopifyProductId: result.shopifyProductId });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Publishing to Shopify failed.";
    // Best-effort — a failure recording the failure shouldn't mask the
    // original error from the response.
    await updateProductRow(productId, { status: "failed" }).catch((sheetsError) => {
      console.error(`Couldn't mark product ${productId} as failed after a publish error`, sheetsError);
    });
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
