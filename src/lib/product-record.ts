import type { ProductFormValues } from "@/lib/product-schemas";
import type { ProductRecord } from "@/types/product";

/**
 * Builds the initial Google Sheet row for a product, written as soon as
 * Generate starts (see /api/products/generate) so the product shows up in
 * history and on the dashboard immediately — not just once it's eventually
 * published. Title and description are blank here; they're filled in once
 * Milestone 7 (AI copy) generates them. `title` falls back to the
 * productId in the meantime so the dashboard never shows a blank row.
 */
export function buildDraftProductRecord(productId: string, values: ProductFormValues): ProductRecord {
  const base = {
    productId,
    category: values.productType,
    title: productId,
    description: "",
    // Filled in once copy is generated and saved at Review (Milestone 7).
    tags: [],
    seoTitle: "",
    metaDescription: "",
    weightGrams: Number(values.weightGrams),
    finish: values.finish,
    stone: values.stone,
    collections: values.collections,
    inventory: Number(values.inventory),
    // Filled in at Finalize (Milestone 9) — nothing upstream collects a price.
    price: 0,
    status: "processing" as const,
    // Filled in once the Drive folder is created (services/product-generation.ts).
    driveFolder: "",
    // Filled in at Finalize (Milestone 9), once one image per category is picked.
    heroImageLink: "",
    lifestyleImageLink: "",
    closeupImageLink: "",
    createdDate: new Date().toISOString().slice(0, 10),
    shopifyProductId: null,
  };

  switch (values.productType) {
    case "earrings":
      return {
        ...base,
        lengthCm: Number(values.lengthCm),
        widthCm: Number(values.widthCm),
        hookType: values.hookType,
        ringSize: null,
        bandWidthMm: null,
        claspType: null,
        chainIncluded: null,
      };
    case "ring":
      return {
        ...base,
        lengthCm: null,
        widthCm: null,
        hookType: null,
        // Both optional now (see product-schemas.ts) — `Number("")` is 0,
        // not a useful "unset" value, so an empty string maps to null
        // instead of silently recording a 0mm band width.
        ringSize: values.ringSize || null,
        bandWidthMm: values.bandWidthMm ? Number(values.bandWidthMm) : null,
        claspType: null,
        chainIncluded: null,
      };
    case "pendant":
      return {
        ...base,
        lengthCm: Number(values.lengthCm),
        widthCm: Number(values.widthCm),
        hookType: null,
        ringSize: null,
        bandWidthMm: null,
        claspType: null,
        chainIncluded: values.chainIncluded,
      };
    case "necklace":
      return {
        ...base,
        lengthCm: Number(values.lengthCm),
        widthCm: null,
        hookType: null,
        ringSize: null,
        bandWidthMm: null,
        claspType: values.claspType,
        chainIncluded: null,
      };
    case "bracelet":
      return {
        ...base,
        lengthCm: Number(values.lengthCm),
        widthCm: null,
        hookType: null,
        ringSize: null,
        bandWidthMm: null,
        claspType: values.claspType,
        chainIncluded: null,
      };
  }
}
