import { NextResponse } from "next/server";
import { findProduct, deleteProductRow } from "@/services/google-sheets";
import { deleteProductFolder } from "@/services/google-drive";

/**
 * A single product's full Sheet row — what the Finalize screen loads
 * (Milestone 9). Distinct from the Review reload route
 * (api/products/[productId]/review/route.ts), which reconstructs a
 * GenerationSession-shaped payload from Sheets + Drive for the image/copy
 * review flow; this just returns the raw ProductRecord, since Finalize only
 * needs plain fields (price, inventory, the already-picked image links,
 * saved copy) and has no need for Drive folder listings or per-category
 * generation results.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ productId: string }> }) {
  const { productId } = await params;

  const lookup = await findProduct(productId).catch((error) => {
    console.error(`Couldn't read product ${productId} from Google Sheets`, error);
    return null;
  });

  if (!lookup) {
    return NextResponse.json({ error: "Product not found." }, { status: 404 });
  }

  return NextResponse.json({ record: lookup.record });
}

/**
 * Deletes a product entirely — its Drive folder (originals + generated
 * images) and its Sheet row. Refuses to delete anything already published to
 * Shopify (`shopifyProductId` set): this app has no Shopify-side delete
 * integration, so removing the local record would just orphan the Shopify
 * draft with nothing here still tracking it. Those have to be removed from
 * Shopify admin first, which the caller can't do from here anyway.
 *
 * Drive deletion runs first and is best-effort (failures are logged, not
 * fatal) — deleteProductFolder is a no-op if the folder's already gone, so a
 * retried DELETE after a partial failure is always safe. The Sheet row is
 * deleted last and is what actually determines success: if that fails, the
 * whole request fails, since the row is this app's source of truth for
 * whether the product still exists.
 */
export async function DELETE(_request: Request, { params }: { params: Promise<{ productId: string }> }) {
  const { productId } = await params;

  const lookup = await findProduct(productId).catch((error) => {
    console.error(`Couldn't read product ${productId} from Google Sheets`, error);
    return null;
  });
  if (!lookup) {
    return NextResponse.json({ error: "Product not found." }, { status: 404 });
  }
  const { record } = lookup;

  if (record.shopifyProductId) {
    return NextResponse.json(
      {
        error:
          "This product is already published to Shopify — remove it from Shopify admin first, then delete it here.",
      },
      { status: 409 }
    );
  }

  await deleteProductFolder(record.category, productId).catch((error) => {
    console.error(`Couldn't delete Drive folder for product ${productId} — continuing to delete the sheet row`, error);
  });

  try {
    await deleteProductRow(productId);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Couldn't delete this product's Google Sheet row." },
      { status: 502 }
    );
  }

  return NextResponse.json({ ok: true });
}
