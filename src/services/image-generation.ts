import "server-only";
import { readAppSettings } from "@/services/app-settings";
import * as leonardo from "@/services/leonardo";
import * as kie from "@/services/kie";
import type { ImageCategory, ProductType } from "@/types/product";
import type { ImagePromptVariables, ReferenceImage, CategoryGenerationResult } from "@/services/leonardo";

/**
 * Picks Kie or Leonardo per the Settings toggle (imageProvider, defaults to
 * "kie" — see services/app-settings.ts) and calls straight through to the
 * matching function. This is the only place that decision gets made —
 * product-generation.ts calls generateAllImages/generateCategoryImages here
 * instead of importing either provider module directly, so neither provider
 * needs to know the other exists, and swapping the default later never
 * means touching product-generation.ts again.
 */
async function activeProvider() {
  const settings = await readAppSettings();
  return settings.imageProvider === "leonardo" ? leonardo : kie;
}

export async function generateAllImages(
  productType: ProductType,
  variables: ImagePromptVariables,
  referenceImages?: ReferenceImage[],
  categories?: ImageCategory[],
  productId?: string
): Promise<CategoryGenerationResult[]> {
  const provider = await activeProvider();
  return provider.generateAllImages(productType, variables, referenceImages, categories, productId);
}

export async function generateCategoryImages(
  productType: ProductType,
  category: ImageCategory,
  variables: ImagePromptVariables,
  referenceImages?: ReferenceImage[],
  productId?: string
): Promise<string[]> {
  const provider = await activeProvider();
  return provider.generateCategoryImages(productType, category, variables, referenceImages, productId);
}
