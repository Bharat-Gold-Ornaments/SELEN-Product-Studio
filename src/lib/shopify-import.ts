import { computeFinalPrice } from "@/lib/pricing";
import type { ShopifyImportCandidate } from "@/services/shopify";
import type { ProductRecord, ProductType } from "@/types/product";

/**
 * Support for importing products that were created directly in Shopify
 * admin (never through this app) into the Sheet, so they show up on
 * /products and /dashboard like any product this app generated. See
 * api/products/import-candidates/route.ts (list) and
 * api/products/import/route.ts (create the Sheet rows).
 */

// Order matters: "earrings" is checked before "ring" so a productType like
// "Earrings" (which itself contains the substring "ring") matches its own
// category first, rather than falsely matching "ring"'s bare keyword.
const CATEGORY_KEYWORDS: { category: ProductType; keywords: string[] }[] = [
  { category: "earrings", keywords: ["earring", "hoop", "stud"] },
  { category: "ring", keywords: ["ring"] },
  { category: "pendant", keywords: ["pendant", "charm"] },
  { category: "necklace", keywords: ["necklace", "chain"] },
  { category: "bracelet", keywords: ["bracelet", "bangle", "cuff"] },
];

/**
 * Best-effort guess at one of this app's 5 fixed categories from Shopify's
 * free-text productType + tags — never authoritative, just a pre-filled
 * starting point for the import review screen, which always requires the
 * user to confirm (or correct) it before import proceeds.
 */
export function guessProductCategory(productType: string, tags: string[]): ProductType | null {
  const haystack = `${productType} ${tags.join(" ")}`.toLowerCase();
  for (const { category, keywords } of CATEGORY_KEYWORDS) {
    if (keywords.some((keyword) => haystack.includes(keyword))) return category;
  }
  return null;
}

/**
 * Inverse of descriptionToHtml (src/lib/shopify-listing.ts) — best-effort,
 * not a full HTML parser. Good enough for the simple `<p>`-per-paragraph
 * shape this app itself writes, and degrades reasonably (tags stripped,
 * common entities decoded) for whatever richer markup a manually-created
 * Shopify product's description actually has.
 */
export function stripHtmlToPlainText(html: string): string {
  if (!html) return "";
  const withBreaks = html.replace(/<\/(p|div|li)>/gi, "\n\n").replace(/<br\s*\/?>/gi, "\n");
  const withoutTags = withBreaks.replace(/<[^>]+>/g, "");
  const decoded = withoutTags
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
  return decoded
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.replace(/\n+/g, " ").trim())
    .filter(Boolean)
    .join("\n\n");
}

/**
 * Same `SP-<base36>` shape generateProductId (src/lib/utils.ts) uses for a
 * normal product, plus a short random suffix — imports can create several
 * rows in one request in a tight server-side loop, where bare
 * `Date.now()` alone could collide within the same millisecond.
 * `usedIds` should include every productId already in the Sheet plus every
 * id already generated earlier in the same import request.
 */
export function generateImportedProductId(usedIds: Set<string>): string {
  let id: string;
  do {
    const stamp = Date.now().toString(36).toUpperCase();
    const suffix = Math.random().toString(36).slice(2, 5).toUpperCase();
    id = `SP-${stamp}${suffix}`;
  } while (usedIds.has(id));
  usedIds.add(id);
  return id;
}

/**
 * Builds the Sheet row for one imported product. Type-specific fields
 * (hookType, ringSize, claspType, ...) are left null across the board —
 * there's no reliable source for them on a manually-created Shopify
 * product, and nothing downstream requires them to be set for an
 * already-published row (they only ever get read back out on Create
 * Product's own form, which imported rows never go through).
 *
 * Price is recomputed through the same formula (src/lib/pricing.ts) every
 * other product uses — `grossWeightGrams` and `makingChargeValue` are the
 * import review screen's own inputs (weight per row, making charge once for
 * the whole batch), never Shopify's live price, since that's exactly the
 * number this app has no way to verify was ever computed the same way.
 * `manualPriceOverride` stays false so this behaves like any other
 * formula-priced product afterward — "Update All Prices" will recompute it
 * on a rate change, same as one created through the normal flow. The
 * computed price is saved to the Sheet but *not* pushed to Shopify here
 * (`priceSyncStatus: ""`, matching a brand-new unpublished product) — an
 * imported row already has a live Shopify price that shouldn't change
 * silently; the user reviews/adjusts on Finalize's Pricing panel and syncs
 * explicitly via its own Save Pricing button when ready.
 */
export function buildImportedProductRecord(
  productId: string,
  candidate: ShopifyImportCandidate,
  category: ProductType,
  grossWeightGrams: number,
  ratePerGram: number,
  makingChargeValue: number
): ProductRecord {
  const [heroImageLink = "", lifestyleImageLink = "", closeupImageLink = ""] = candidate.imageUrls;
  // No separate gross/net weight source exists for an imported product —
  // mirroring net to gross keeps it in Case A (no separate stone pricing)
  // rather than spuriously landing in Case B (gross !== net) and demanding
  // stone line items for data that was never actually measured separately.
  const netWeightGrams = grossWeightGrams;
  const price = computeFinalPrice({
    grossWeightGrams,
    netWeightGrams,
    ratePerGram,
    makingChargeMode: "per_gram",
    makingChargeValue,
    stoneLineItems: [],
  });

  return {
    productId,
    category,
    title: candidate.title,
    description: stripHtmlToPlainText(candidate.descriptionHtml),
    tags: candidate.tags,
    seoTitle: candidate.seoTitle,
    metaDescription: candidate.metaDescription,
    weightGrams: grossWeightGrams,
    lengthCm: candidate.lengthCm,
    widthCm: candidate.widthCm,
    finish: candidate.finish ?? "",
    stone: candidate.stone ?? "",
    hookType: null,
    ringSize: null,
    bandWidthMm: null,
    claspType: null,
    chainIncluded: null,
    collections: candidate.collections,
    inventory: candidate.inventory,
    price,
    status: "published",
    driveFolder: "",
    heroImageLink,
    lifestyleImageLink,
    closeupImageLink,
    createdDate: candidate.createdAt.slice(0, 10),
    shopifyProductId: candidate.shopifyProductId,
    netWeightGrams,
    makingChargeMode: "per_gram",
    makingChargeValue,
    stoneLineItems: "",
    manualPriceOverride: false,
    priceSyncStatus: "",
    priceSyncedAt: "",
    listingSyncStatus: "",
    listingSyncedAt: "",
    // An imported product's real Shopify variants (if it has more than one)
    // aren't read back individually — see ShopifyImportCandidate's doc
    // comment on `price`/`inventory` above — so this starts variant-less
    // here too rather than fabricating rows from data that was never
    // actually parsed per-variant.
    variants: "",
    variantsSyncStatus: "",
    variantsSyncedAt: "",
    variantColorImages: "",
    inventorySyncStatus: "",
    inventorySyncedAt: "",
    // Imported products weren't created from an Inventory row.
    sku: "",
  };
}
