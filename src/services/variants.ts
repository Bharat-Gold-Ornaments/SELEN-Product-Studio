import "server-only";
import { findProduct, updateProductRow } from "@/services/google-sheets";
import { syncShopifyProductVariants } from "@/services/shopify";
import { readAppSettings } from "@/services/app-settings";
import { loadPickedShopifyImages, loadVariantColorShopifyImages } from "@/lib/shopify-listing";
import {
  downloadFile,
  driveFileIdFromImageProxyUrl,
  ensureProductFolders,
  createFolder,
  uploadGenerated,
} from "@/services/google-drive";
import { generateVariantColorImages } from "@/services/product-generation";
import { buildImagePromptVariablesFromRecord } from "@/lib/generation-variables";
import { parseStoneLineItems } from "@/lib/pricing";
import {
  parseVariantRows,
  serializeVariantRows,
  resolveVariantPrice,
  validateVariantRows,
  parseVariantColorImages,
  serializeVariantColorImages,
  colorsNeedingGeneratedImages,
  findVariantColorImageSet,
  colorSlug,
  type VariantRow,
  type VariantColorImage,
  type VariantColorImageSet,
  type VariantPricingContext,
} from "@/lib/variants";
import type { ProductRecord, ImageCategory } from "@/types/product";

/** Same rate/making-charge/stones the product's own Pricing panel uses — see priceInputsFromRecord in services/pricing.ts, mirrored here so a variant's custom price is computed with the exact inputs that would produce the main price for the same weight. */
async function variantPricingContext(record: ProductRecord): Promise<VariantPricingContext> {
  const settings = await readAppSettings();
  return {
    ratePerGram: settings.ratePerGram,
    makingChargeMode: record.makingChargeMode,
    makingChargeValue: record.makingChargeValue,
    stoneLineItems: parseStoneLineItems(record.stoneLineItems),
  };
}

export interface SaveProductVariantsResult {
  variants: VariantRow[];
  variantsSyncStatus: ProductRecord["variantsSyncStatus"];
  variantsSyncedAt: string;
}

/** The product's base photos plus, for any row using its own gallery (not the default images), that color's own gallery — everything syncShopifyProductVariants needs to correctly stage every variant's photos. */
async function loadAllShopifyImagesForVariants(record: ProductRecord, rows: VariantRow[]) {
  const [baseImages, colorImages] = await Promise.all([
    loadPickedShopifyImages(record),
    loadVariantColorShopifyImages(
      parseVariantColorImages(record.variantColorImages),
      colorsNeedingGeneratedImages(rows, record.finish)
    ),
  ]);
  return [...baseImages, ...colorImages];
}

/**
 * Saves one product's variant rows and — per this project's "sync
 * immediately on save" decision, same as services/pricing.ts's
 * saveProductPricing — pushes them to Shopify right away if the product is
 * already published. A push failure doesn't fail the save: the rows are
 * still persisted to the Sheet, just flagged `variantsSyncStatus:
 * "out_of_sync"` for a manual retry. Saving an empty row list (all variants
 * removed) is allowed and always succeeds locally, but is never pushed to
 * Shopify — see syncShopifyProductVariants's own doc comment for why.
 */
export async function saveProductVariants(productId: string, rows: VariantRow[]): Promise<SaveProductVariantsResult> {
  const validationError = validateVariantRows(rows);
  if (validationError) throw new Error(validationError);

  const lookup = await findProduct(productId);
  if (!lookup) throw new Error("Product not found.");
  const { record } = lookup;

  let variantsSyncStatus = record.variantsSyncStatus;
  let variantsSyncedAt = record.variantsSyncedAt;

  if (rows.length === 0) {
    // Nothing left to keep in sync — Shopify's existing variants (if any)
    // are deliberately left untouched (see syncShopifyProductVariants), so
    // there's no meaningful "synced"/"out of sync" state to track anymore.
    variantsSyncStatus = "";
    variantsSyncedAt = "";
  } else if (record.shopifyProductId) {
    try {
      const [images, pricing] = await Promise.all([
        loadAllShopifyImagesForVariants(record, rows),
        variantPricingContext(record),
      ]);
      await syncShopifyProductVariants({
        shopifyProductId: record.shopifyProductId,
        price: record.price,
        inventory: record.inventory,
        images,
        variants: rows.map((row) => ({
          color: row.color,
          size: row.size,
          price: resolveVariantPrice(row, record.price, pricing),
          inventory: row.inventory,
          useDefaultImages: row.useDefaultImages,
          grossWeightGrams: row.grossWeightGrams,
        })),
      });
      variantsSyncStatus = "synced";
      variantsSyncedAt = new Date().toISOString();
    } catch (error) {
      variantsSyncStatus = "out_of_sync";
      console.error(`Couldn't sync variants to Shopify for product ${productId}:`, error);
    }
  }

  await updateProductRow(productId, {
    variants: serializeVariantRows(rows),
    variantsSyncStatus,
    variantsSyncedAt,
  });

  return { variants: rows, variantsSyncStatus, variantsSyncedAt };
}

/**
 * Retries syncing whatever variants are already saved for a product flagged
 * `variantsSyncStatus: "out_of_sync"` — the manual re-push counterpart to
 * retryPriceSync in services/pricing.ts. Doesn't recompute anything; it
 * resends exactly what's already in the sheet.
 */
export async function retryVariantsSync(productId: string): Promise<SaveProductVariantsResult> {
  const lookup = await findProduct(productId);
  if (!lookup) throw new Error("Product not found.");
  const { record } = lookup;

  if (!record.shopifyProductId) {
    throw new Error("This product hasn't been published to Shopify yet.");
  }
  const rows = parseVariantRows(record.variants);
  if (rows.length === 0) {
    throw new Error("No saved variants to sync.");
  }

  const [images, pricing] = await Promise.all([
    loadAllShopifyImagesForVariants(record, rows),
    variantPricingContext(record),
  ]);
  await syncShopifyProductVariants({
    shopifyProductId: record.shopifyProductId,
    price: record.price,
    inventory: record.inventory,
    images,
    variants: rows.map((row) => ({
      color: row.color,
      size: row.size,
      price: resolveVariantPrice(row, record.price, pricing),
      inventory: row.inventory,
      useDefaultImages: row.useDefaultImages,
      grossWeightGrams: row.grossWeightGrams,
    })),
  });

  const variantsSyncedAt = new Date().toISOString();
  await updateProductRow(productId, { variantsSyncStatus: "synced", variantsSyncedAt });
  return { variants: rows, variantsSyncStatus: "synced", variantsSyncedAt };
}

function upsertColorImageSet(sets: VariantColorImageSet[], next: VariantColorImageSet): VariantColorImageSet[] {
  const normalized = next.color.trim().toLowerCase();
  return [...sets.filter((set) => set.color.trim().toLowerCase() !== normalized), next];
}

/**
 * AI-generates Hero/Lifestyle/Closeup photos for one variant Color, using
 * the product's own default-variant photos as the image-to-image reference
 * (see product-generation.ts's generateVariantColorImages for why — the
 * point is a recolor of the exact same shot, not a fresh reinterpretation).
 * Persists a "generating" status immediately so a page reload mid-generation
 * shows real in-progress state, then "ready"/"failed" once done. Only
 * replaces this color's previous `source: "generated"` images (matched by
 * category) — any manually-added photos (see uploadVariantColorImage) are
 * left untouched, so repeated regeneration never duplicates and never loses
 * a hand-picked correction. Never throws for a generation failure — the
 * failure is recorded in the returned/saved set's `status`/`error` instead,
 * same reasoning as saveProductPricing never letting a Shopify sync failure
 * fail the request.
 */
export async function generateVariantPhotos(productId: string, color: string): Promise<VariantColorImageSet> {
  const lookup = await findProduct(productId);
  if (!lookup) throw new Error("Product not found.");
  const { record } = lookup;

  const categoryLinks: [ImageCategory, string][] = [
    ["hero", record.heroImageLink],
    ["lifestyle", record.lifestyleImageLink],
    ["closeup", record.closeupImageLink],
  ];
  const available = categoryLinks.filter(([, link]) => Boolean(link));
  if (available.length === 0) {
    throw new Error(
      "This product has no picked photos yet — pick at least one on Review before generating variant photos."
    );
  }

  const existingSets = parseVariantColorImages(record.variantColorImages);
  const existing = findVariantColorImageSet(existingSets, color);
  const manualImages = existing?.images.filter((image) => image.source === "manual") ?? [];

  await updateProductRow(productId, {
    variantColorImages: serializeVariantColorImages(
      upsertColorImageSet(existingSets, {
        color,
        images: manualImages,
        status: "generating",
      })
    ),
  });

  let finalSet: VariantColorImageSet;
  try {
    const defaultImages: Partial<Record<ImageCategory, { buffer: Buffer; mimeType: string }>> = {};
    for (const [category, link] of available) {
      const { buffer, mimeType } = await downloadFile(driveFileIdFromImageProxyUrl(link));
      defaultImages[category] = { buffer, mimeType };
    }

    const variables = { ...buildImagePromptVariablesFromRecord(record), finish: color };
    const { results, usedTextToImageFallback } = await generateVariantColorImages(
      productId,
      record.category,
      variables,
      defaultImages,
      color
    );

    const generatedImages: VariantColorImage[] = [];
    let firstError: string | undefined;
    for (const result of results) {
      if (result.status === "success") {
        generatedImages.push({
          id: crypto.randomUUID(),
          url: result.imageUrls[0],
          source: "generated",
          category: result.category,
        });
      } else {
        firstError ??= result.message;
      }
    }
    // A category that fails this round falls back to whatever it already
    // had rather than being dropped — a partial regenerate failure
    // shouldn't lose a perfectly good photo from a previous run.
    const previousGenerated = existing?.images.filter((image) => image.source === "generated") ?? [];
    for (const previous of previousGenerated) {
      if (!generatedImages.some((image) => image.category === previous.category)) {
        generatedImages.push(previous);
      }
    }
    const images = [...generatedImages, ...manualImages];

    finalSet = {
      color,
      images,
      status: images.length > 0 ? "ready" : "failed",
      error: images.length > 0 ? undefined : firstError ?? "Image generation failed.",
      usedTextToImageFallback,
    };
  } catch (error) {
    finalSet = {
      color,
      images: manualImages,
      status: manualImages.length > 0 ? "ready" : "failed",
      error: manualImages.length > 0 ? undefined : error instanceof Error ? error.message : "Image generation failed.",
    };
  }

  await updateProductRow(productId, {
    variantColorImages: serializeVariantColorImages(upsertColorImageSet(existingSets, finalSet)),
  });
  return finalSet;
}

function extensionFromMimeType(mimeType: string): string {
  return (mimeType.split("/")[1] || "jpg").replace("jpeg", "jpg");
}

/**
 * Manually adds one photo to a variant Color's gallery — the escape hatch
 * for when an AI-generated shot (generateVariantPhotos above) isn't good
 * enough, or simply to add more angles than generation produces. Uploads
 * into the exact same per-color Drive subfolder AI generation uses, so a
 * hand-picked photo is indistinguishable from a generated one to everything
 * downstream (Shopify staging). Purely additive — never touches any other
 * photo already in the gallery. Always marks the set "ready": a photo a
 * human just picked is definitionally usable.
 */
export async function uploadVariantColorImage(
  productId: string,
  color: string,
  buffer: Buffer,
  mimeType: string
): Promise<VariantColorImageSet> {
  const lookup = await findProduct(productId);
  if (!lookup) throw new Error("Product not found.");
  const { record } = lookup;

  const existingSets = parseVariantColorImages(record.variantColorImages);
  const existing = findVariantColorImageSet(existingSets, color);
  const newImage: VariantColorImage = { id: crypto.randomUUID(), url: "", source: "manual" };

  const folders = await ensureProductFolders(record.category, productId);
  const colorFolderId = await createFolder(colorSlug(color), folders.generatedFolderId);
  const { publicUrl } = await uploadGenerated(
    colorFolderId,
    `manual-${newImage.id}.${extensionFromMimeType(mimeType)}`,
    buffer,
    mimeType
  );
  newImage.url = publicUrl;

  const next: VariantColorImageSet = {
    color,
    images: [...(existing?.images ?? []), newImage],
    status: "ready",
  };

  await updateProductRow(productId, {
    variantColorImages: serializeVariantColorImages(upsertColorImageSet(existingSets, next)),
  });
  return next;
}

/**
 * Removes one photo from a variant Color's gallery — the counterpart to
 * uploadVariantColorImage/generateVariantPhotos. Doesn't clean up the Drive
 * file itself (same "no retroactive cleanup" stance as removing a variant
 * row entirely); just drops it from the JSON list so it's no longer staged
 * to Shopify on the next save/publish. If the color's gallery is now empty,
 * the set stays but flips to "failed" so the Variants panel shows "Not
 * generated" rather than a stale "Ready" badge with nothing to show for it.
 */
export async function removeVariantColorImage(
  productId: string,
  color: string,
  imageId: string
): Promise<VariantColorImageSet> {
  const lookup = await findProduct(productId);
  if (!lookup) throw new Error("Product not found.");
  const { record } = lookup;

  const existingSets = parseVariantColorImages(record.variantColorImages);
  const existing = findVariantColorImageSet(existingSets, color);
  if (!existing) throw new Error(`No photo gallery found for "${color}".`);

  const images = existing.images.filter((image) => image.id !== imageId);
  const next: VariantColorImageSet = {
    ...existing,
    images,
    status: images.length > 0 ? "ready" : "failed",
    error: images.length > 0 ? undefined : "No photos left — generate or add one.",
  };

  await updateProductRow(productId, {
    variantColorImages: serializeVariantColorImages(upsertColorImageSet(existingSets, next)),
  });
  return next;
}
