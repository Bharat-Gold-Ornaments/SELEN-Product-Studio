import { NextResponse } from "next/server";
import { listProducts } from "@/services/google-sheets";
import { listShopifyProductsForImport, type ShopifyImportCandidate } from "@/services/shopify";
import { guessProductCategory } from "@/lib/shopify-import";
import type { ProductType } from "@/types/product";

export const maxDuration = 30;

export interface ImportCandidateResponse extends ShopifyImportCandidate {
  guessedCategory: ProductType | null;
}

/**
 * Lists Shopify products not yet tracked in the Sheet — candidates for the
 * "Import from Shopify" screen (src/components/products/import-client.tsx).
 * Read-only on both sides: doesn't touch Shopify or the Sheet, just compares
 * them. See src/lib/shopify-import.ts for the guess/build logic actually
 * used at import time.
 */
export async function GET() {
  let trackedShopifyIds: Set<string>;
  try {
    const existing = await listProducts();
    trackedShopifyIds = new Set(existing.map((p) => p.shopifyProductId).filter((id): id is string => Boolean(id)));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Couldn't read existing products from Google Sheets." },
      { status: 502 }
    );
  }

  let shopifyProducts: ShopifyImportCandidate[];
  try {
    shopifyProducts = await listShopifyProductsForImport();
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Couldn't load products from Shopify." },
      { status: 502 }
    );
  }

  const candidates: ImportCandidateResponse[] = shopifyProducts
    .filter((product) => !trackedShopifyIds.has(product.shopifyProductId))
    .map((product) => ({
      ...product,
      guessedCategory: guessProductCategory(product.productType, product.tags),
    }));

  return NextResponse.json({ candidates });
}
