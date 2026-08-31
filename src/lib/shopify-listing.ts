import { downloadFile, driveFileIdFromImageProxyUrl } from "@/services/google-drive";
import { colorSlug, findVariantColorImageSet, type VariantColorImageSet } from "@/lib/variants";
import type { ShopifyImageInput } from "@/services/shopify";
import type { ImageCategory, ProductRecord } from "@/types/product";

/**
 * Shared between Publish (api/products/[productId]/publish/route.ts) and
 * Update Shopify Listing (api/products/[productId]/sync/route.ts) — both
 * send a product's current title/description/tags/SEO/photos to Shopify,
 * just at different moments (initial publish vs. a post-publish re-push),
 * so the logic for turning a saved ProductRecord into Shopify-ready inputs
 * lives here once instead of drifting between two copies.
 */

export const IMAGE_CATEGORIES_IN_LISTING_ORDER: ImageCategory[] = ["hero", "lifestyle", "closeup"];

// Wraps each paragraph (blank-line-separated) in its own <p> — templates/
// description.txt now asks Claude for a single short line, but this still
// handles a multi-paragraph response gracefully if that ever changes.
// descriptionHtml is, as the name says, HTML, but the copy service
// (services/anthropic-copy.ts) only ever produces plain text.
// Escapes the handful of characters that would otherwise be interpreted as
// markup if a paragraph happened to contain a literal "<" or "&".
export function descriptionToHtml(text: string): string {
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

/**
 * Downloads whichever picked images' real bytes from Drive (never a public
 * URL — Shopify has no session cookie to fetch this app's auth-gated
 * `/api/drive-image/[fileId]` proxy with) and shapes them for
 * services/shopify.ts. Throws if the product has no picked image at all —
 * both callers treat that as a hard requirement, not something to publish/
 * sync around silently.
 */
export async function loadPickedShopifyImages(record: ProductRecord): Promise<ShopifyImageInput[]> {
  const linkByCategory: Record<ImageCategory, string> = {
    hero: record.heroImageLink,
    lifestyle: record.lifestyleImageLink,
    closeup: record.closeupImageLink,
  };
  const picked = IMAGE_CATEGORIES_IN_LISTING_ORDER.filter((category) => linkByCategory[category]);
  if (picked.length === 0) {
    throw new Error("This product has no picked images — pick at least one image on Review first.");
  }

  return Promise.all(
    picked.map(async (category) => {
      const fileId = driveFileIdFromImageProxyUrl(linkByCategory[category]);
      const { buffer, mimeType } = await downloadFile(fileId);
      return {
        buffer,
        mimeType,
        filename: `${category}.${extensionFromMimeType(mimeType)}`,
        alt: record.title,
        category,
      };
    })
  );
}

/**
 * Downloads every photo in a set of variant Colors' galleries (see
 * src/lib/variants.ts's VariantColorImageSet — any number per color, mixing
 * AI-generated and manually-uploaded) and shapes them for services/
 * shopify.ts the same way loadPickedShopifyImages does for the product's
 * base photos — each tagged with `color` so shopify.ts's gallery-attach step
 * knows which variant(s) to attach it to. A color with no gallery yet (still
 * generating, failed, or never requested) simply contributes nothing —
 * services/shopify.ts's attach step just has nothing to attach for that
 * variant in that case, never errors.
 */
export async function loadVariantColorShopifyImages(
  colorImageSets: VariantColorImageSet[],
  colors: string[]
): Promise<ShopifyImageInput[]> {
  const images: ShopifyImageInput[] = [];

  for (const color of colors) {
    const set = findVariantColorImageSet(colorImageSets, color);
    if (!set) continue;

    for (const image of set.images) {
      const fileId = driveFileIdFromImageProxyUrl(image.url);
      const { buffer, mimeType } = await downloadFile(fileId);
      images.push({
        buffer,
        mimeType,
        // image.id keeps this unique even for two manually-uploaded photos
        // of the same color, which have no category to disambiguate by.
        filename: `${colorSlug(color)}-${image.id}.${extensionFromMimeType(mimeType)}`,
        alt: `${color}${image.category ? ` ${image.category}` : ""}`,
        category: image.category,
        color,
      });
    }
  }

  return images;
}
