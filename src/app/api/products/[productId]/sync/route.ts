import { NextResponse } from "next/server";
import { findProduct, updateProductRow } from "@/services/google-sheets";
import { updateShopifyProductListing } from "@/services/shopify";
import { descriptionToHtml, loadPickedShopifyImages } from "@/lib/shopify-listing";

export const maxDuration = 90;

/**
 * Re-pushes a product's title/description/tags/SEO/photos to its existing
 * Shopify listing — Finalize's "Update Shopify Listing" action, for edits
 * made on Review (or a re-picked image) after the initial Publish. Unlike
 * Publish, this never touches status/price/inventory; it just sends
 * whatever's currently saved in this product's Sheet row, since Review's
 * Continue already wrote any edits there before the user ever gets back to
 * this button. Mirrors services/pricing.ts's saveProductPricing: on
 * failure, flag `listingSyncStatus: "out_of_sync"` rather than block —
 * clicking the same button again is the retry, no separate retry route
 * needed since this always re-sends the current state anyway.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ productId: string }> }) {
  const { productId } = await params;

  const lookup = await findProduct(productId).catch(() => null);
  if (!lookup) {
    return NextResponse.json({ error: "Product not found." }, { status: 404 });
  }
  const { record } = lookup;

  if (!record.shopifyProductId) {
    return NextResponse.json({ error: "This product hasn't been published to Shopify yet." }, { status: 400 });
  }
  if (!record.description.trim()) {
    return NextResponse.json({ error: "This product has no saved copy to sync." }, { status: 400 });
  }

  try {
    const images = await loadPickedShopifyImages(record);
    await updateShopifyProductListing({
      shopifyProductId: record.shopifyProductId,
      title: record.title,
      descriptionHtml: descriptionToHtml(record.description),
      tags: record.tags,
      seoTitle: record.seoTitle || record.title,
      metaDescription: record.metaDescription,
      images,
    });

    const listingSyncedAt = new Date().toISOString();
    await updateProductRow(productId, { listingSyncStatus: "synced", listingSyncedAt });
    return NextResponse.json({ ok: true, listingSyncStatus: "synced", listingSyncedAt });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Couldn't update the Shopify listing.";
    // Best-effort — a failure recording the failure shouldn't mask the
    // original error from the response.
    await updateProductRow(productId, { listingSyncStatus: "out_of_sync" }).catch((sheetsError) => {
      console.error(`Couldn't flag product ${productId} as out_of_sync after a listing sync failure`, sheetsError);
    });
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
