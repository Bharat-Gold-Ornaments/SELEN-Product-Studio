import { NextResponse } from "next/server";
import { findProduct } from "@/services/google-sheets";

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
