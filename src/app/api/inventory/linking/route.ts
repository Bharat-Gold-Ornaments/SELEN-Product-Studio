import { NextResponse } from "next/server";
import { getLinkingOverview, linkProduct } from "@/services/product-linking";
import { StockInputError } from "@/services/stock";
import type { LinkProductInput } from "@/types/product-linking";

// Reads every published product's variants from Shopify.
export const maxDuration = 90;

/** Every product with its pieces, what each is linked to, and suggested Inventory SKUs. */
export async function GET() {
  try {
    return NextResponse.json(await getLinkingOverview());
  } catch (error) {
    console.error("Failed to build the linking overview", error);
    const message = error instanceof Error ? error.message : "Couldn't load products to link.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** Links one product's pieces to Inventory SKUs, as confirmed on the Linking tab. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as LinkProductInput | null;
  if (!body?.productId || !Array.isArray(body.links) || body.links.length === 0) {
    return NextResponse.json({ error: "Pick at least one SKU to link." }, { status: 400 });
  }
  try {
    return NextResponse.json(await linkProduct(body));
  } catch (error) {
    if (error instanceof StockInputError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error(`Failed to link product ${body.productId}`, error);
    const message = error instanceof Error ? error.message : "Couldn't link this product.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
