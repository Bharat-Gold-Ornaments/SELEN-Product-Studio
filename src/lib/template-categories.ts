import type { ImageCategory, ProductType } from "@/types/product";
import { PRODUCT_TYPES, IMAGE_CATEGORIES, IMAGE_CATEGORY_LABELS } from "@/lib/constants";

/**
 * Image-prompt ids are compound — one per (product type, image category)
 * pair, e.g. "ring-hero" — since each product type now gets its own prompt
 * per category instead of one shared prompt across all five types. Copy
 * prompt ids are unchanged: title/description/SEO/tags still apply the same
 * way regardless of product type.
 */
export type ImageTemplateId = `${ProductType}-${ImageCategory}`;
export type TemplateCategoryId = ImageTemplateId | "title" | "description" | "seo" | "tags" | "collections";

export interface TemplateCategoryMeta {
  id: TemplateCategoryId;
  label: string;
  group: "Image prompts" | "Copy prompts";
  description: string;
  /** {{variable}} placeholders this template is expected to use. */
  variables: string[];
  /** Set only for "Image prompts" entries — used to group the Template Manager's nav by product type. */
  productType?: ProductType;
}

export function imageTemplateId(productType: ProductType, category: ImageCategory): ImageTemplateId {
  return `${productType}-${category}`;
}

// `referenceNote` is filled in by services/leonardo.ts at generation time
// (not by generation-variables.ts) — it's a short instruction sentence that
// only appears when the product actually has an uploaded reference photo to
// do image-to-image generation from; it renders as an empty string
// otherwise. Every image template is expected to place it somewhere near
// the top as its own sentence, since it disappears cleanly when unused.
const commonImageVariables = [
  "productType",
  "finish",
  "stone",
  "dimensions",
  "collections",
  "referenceNote",
];

// One entry per (category, description-blurb) pair, expanded below into a
// full TemplateCategoryMeta for each of the 5 product types — every product
// type gets its own independently-editable prompt per category instead of
// sharing one across all five.
const IMAGE_CATEGORY_BLURB: Record<ImageCategory, string> = {
  hero: "the primary studio product shot",
  lifestyle: "the worn / styled lifestyle shot",
  closeup: "the macro detail shot",
};

const imageTemplateEntries: TemplateCategoryMeta[] = PRODUCT_TYPES.flatMap(({ value: productType, label: productLabel }) =>
  IMAGE_CATEGORIES.map((category) => ({
    id: imageTemplateId(productType, category),
    label: `${productLabel} — ${IMAGE_CATEGORY_LABELS[category].replace(" Images", "")}`,
    group: "Image prompts" as const,
    description: `Leonardo prompt for ${productLabel.toLowerCase()}'s ${IMAGE_CATEGORY_BLURB[category]}. Add a "--- NEGATIVE PROMPT ---" line to include a negative prompt.`,
    variables: commonImageVariables,
    productType,
  }))
);

export const TEMPLATE_CATEGORIES: TemplateCategoryMeta[] = [
  ...imageTemplateEntries,
  {
    id: "title",
    label: "Title Prompt",
    group: "Copy prompts",
    description: "Instructs the copy model to write the 2-3 word product title.",
    variables: ["productType", "finish", "stone", "dimensions", "collections"],
  },
  {
    id: "description",
    label: "Description Prompt",
    group: "Copy prompts",
    description: "Instructs the copy model to write the Shopify product description.",
    variables: ["title", "productType", "finish", "stone", "dimensions", "collections"],
  },
  {
    id: "seo",
    label: "SEO Prompt",
    group: "Copy prompts",
    description: "Instructs the copy model to write the SEO title and meta description.",
    variables: ["title", "productType", "finish", "stone"],
  },
  {
    id: "tags",
    label: "Tags Prompt",
    group: "Copy prompts",
    description: "Instructs the copy model to write comma-separated Shopify tags.",
    variables: ["title", "productType", "finish", "stone", "collections"],
  },
  {
    id: "collections",
    label: "Collection Classification Prompt",
    group: "Copy prompts",
    description:
      "Instructs the copy model (with the lifestyle image attached) to pick which of the store's real collections this product fits.",
    variables: ["title", "productType", "finish", "stone", "availableCollections"],
  },
];

export function isTemplateCategoryId(value: string): value is TemplateCategoryId {
  return TEMPLATE_CATEGORIES.some((category) => category.id === value);
}
