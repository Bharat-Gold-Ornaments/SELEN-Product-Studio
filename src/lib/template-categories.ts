export type TemplateCategoryId =
  | "hero"
  | "lifestyle"
  | "closeup"
  | "title"
  | "description"
  | "seo"
  | "tags";

export interface TemplateCategoryMeta {
  id: TemplateCategoryId;
  label: string;
  group: "Image prompts" | "Copy prompts";
  description: string;
  /** {{variable}} placeholders this template is expected to use. */
  variables: string[];
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

export const TEMPLATE_CATEGORIES: TemplateCategoryMeta[] = [
  {
    id: "hero",
    label: "Hero Prompt",
    group: "Image prompts",
    description:
      "Leonardo prompt for the primary studio product shot. Add a \"--- NEGATIVE PROMPT ---\" line to include a negative prompt.",
    variables: commonImageVariables,
  },
  {
    id: "lifestyle",
    label: "Lifestyle Prompt",
    group: "Image prompts",
    description:
      "Leonardo prompt for the worn / styled lifestyle shot. Add a \"--- NEGATIVE PROMPT ---\" line to include a negative prompt.",
    variables: commonImageVariables,
  },
  {
    id: "closeup",
    label: "Closeup Prompt",
    group: "Image prompts",
    description:
      "Leonardo prompt for the macro detail shot. Add a \"--- NEGATIVE PROMPT ---\" line to include a negative prompt.",
    variables: commonImageVariables,
  },
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
];

export function isTemplateCategoryId(value: string): value is TemplateCategoryId {
  return TEMPLATE_CATEGORIES.some((category) => category.id === value);
}
