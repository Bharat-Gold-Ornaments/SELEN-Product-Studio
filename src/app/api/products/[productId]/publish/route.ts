import { NextResponse } from "next/server";
import { z } from "zod";
import { findProduct, updateProductRow } from "@/services/google-sheets";
import { downloadFile, driveFileIdFromImageProxyUrl } from "@/services/google-drive";
import { publishProductToShopify, type ShopifyImageInput } from "@/services/shopify";
import { PRODUCT_TYPES } from "@/lib/constants";
import type { ImageCategory } from "@/types/product";

export const maxDuration = 90;

const bodySchema = z.object({
  price: z.number().positive("Price must be greater than 0."),
  inventory: z.number().int().nonnegative("Inventory can't be negative."),
});

// Wraps each paragraph (blank-line-separated) in its own <p> — templates/
// description.txt now asks Claude for a single short line, but this still
// handles a multi-paragraph response gracefully if that ever changes.
// descriptionHtml is, as the name says, HTML, but the copy service
// (services/anthropic-copy.ts) only ever produces plain text.
// Escapes the handful of characters that would otherwise be interpreted as
// markup if a paragraph happened to contain a literal "<" or "&".
function descriptionToHtml(text: string): string {
  const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => `<p>${escape(paragraph)}</p>`)
    .join("");
}

function extensionFromMimeType(mimeType: string): string {
  return (mimeType.split("/")[1] || "jpg").replace("jpeg", "jpg");
}

const IMAGE_CATEGORIES_IN_LISTING_ORDER: ImageCategory[] = ["hero", "lifestyle", "closeup"];

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

  const linkByCategory: Record<ImageCategory, string> = {
    hero: record.heroImageLink,
    lifestyle: record.lifestyleImageLink,
    closeup: record.closeupImageLink,
  };
  // At least one picked image is enough — Review allows a subset (see
  // review-client.tsx's hasSelection), so this can't require every category,
  // only that the product isn't going out with zero images entirely.
  const picked = IMAGE_CATEGORIES_IN_LISTING_ORDER.filter((category) => linkByCategory[category]);
  if (picked.length === 0) {
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
    const images: ShopifyImageInput[] = await Promise.all(
      picked.map(async (category) => {
        const fileId = driveFileIdFromImageProxyUrl(linkByCategory[category]);
        const { buffer, mimeType } = await downloadFile(fileId);
        return {
          buffer,
          mimeType,
          filename: `${category}.${extensionFromMimeType(mimeType)}`,
          alt: record.title,
        };
      })
    );

    const productType = PRODUCT_TYPES.find((t) => t.value === record.category)?.label ?? record.category;

    const result = await publishProductToShopify({
      title: record.title,
      descriptionHtml: descriptionToHtml(record.description),
      tags: record.tags,
      productType,
      price,
      inventory,
      images,
      seoTitle: record.seoTitle || record.title,
      metaDescription: record.metaDescription,
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
