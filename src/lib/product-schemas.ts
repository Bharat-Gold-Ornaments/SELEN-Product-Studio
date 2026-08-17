import { z } from "zod";
import type { ProductType } from "@/types/product";

// ── Shared option lists ─────────────────────────────────────────────────────

export const HOOK_TYPE_OPTIONS = [
  "Lever Back",
  "Push Back",
  "French Hook",
  "Huggie",
  "Clip-On",
] as const;

export const RING_SIZE_OPTIONS = Array.from({ length: 19 }, (_, i) => {
  const size = 4 + i * 0.5; // 4 -> 13 in half sizes
  return size.toString();
});

export const CLASP_TYPE_OPTIONS = [
  "Lobster Clasp",
  "Toggle Clasp",
  "Magnetic Clasp",
  "Spring Ring",
] as const;

// ── Field-level validation helpers ──────────────────────────────────────────
// Numeric inputs are modelled as validated strings (matching what a native
// <input type="number"> hands React Hook Form) and converted to numbers only
// once, when the validated payload is assembled for submission. This keeps
// the Zod schema types simple and avoids fighting RHF over string vs. number
// field typing.

const positiveNumberString = (label: string) =>
  z
    .string()
    .min(1, `${label} is required`)
    .refine((v) => !Number.isNaN(Number(v)) && Number(v) > 0, `Enter a valid ${label.toLowerCase()}`);

/** Same as positiveNumberString, but an empty string is valid too — for fields that aren't always known up front. */
const optionalPositiveNumberString = (label: string) =>
  z
    .string()
    .refine((v) => v === "" || (!Number.isNaN(Number(v)) && Number(v) > 0), `Enter a valid ${label.toLowerCase()}`);

const wholeNumberString = z
  .string()
  .min(1, "Inventory is required")
  .refine((v) => Number.isInteger(Number(v)) && Number(v) >= 0, "Enter a whole number, 0 or more");

const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const ACCEPTED_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];

// Photos are optional — a product can be created with only some of its
// reference shots on hand, and the rest added later. Uses `.nullish()`
// (accepts both `undefined` and `null`) because a browser FormData entry
// that was never appended comes back as `null` from `formData.get()`, not
// `undefined`.
const photoField = (label: string) =>
  z
    .instanceof(File)
    .refine((f) => f.size <= MAX_PHOTO_BYTES, `${label} must be under 10MB`)
    .refine((f) => ACCEPTED_PHOTO_TYPES.includes(f.type), `${label} must be a JPG, PNG, or WEBP`)
    .nullish();

const baseShape = {
  frontPhoto: photoField("Front Photo"),
  sidePhoto: photoField("Side Photo"),
  wornPhoto: photoField("Worn Photo"),
  weightGrams: positiveNumberString("Weight"),
  finish: z.string().min(1, "Finish is required"),
  stone: z.string().min(1, 'Enter a stone, or "None"'),
  collections: z.array(z.string()).default([]),
  inventory: wholeNumberString,
  status: z.enum(["draft", "processing", "publishing", "published", "failed"]).default("draft"),
};

export const earringsSchema = z.object({
  productType: z.literal("earrings"),
  ...baseShape,
  lengthCm: positiveNumberString("Length"),
  widthCm: positiveNumberString("Width"),
  hookType: z.string().min(1, "Select a hook type"),
});

export const ringSchema = z.object({
  productType: z.literal("ring"),
  ...baseShape,
  ringSize: z.string(),
  bandWidthMm: optionalPositiveNumberString("Band width"),
});

export const pendantSchema = z.object({
  productType: z.literal("pendant"),
  ...baseShape,
  lengthCm: positiveNumberString("Length"),
  widthCm: positiveNumberString("Width"),
  chainIncluded: z.boolean().default(false),
});

export const necklaceSchema = z.object({
  productType: z.literal("necklace"),
  ...baseShape,
  lengthCm: positiveNumberString("Length"),
  claspType: z.string().min(1, "Select a clasp type"),
});

export const braceletSchema = z.object({
  productType: z.literal("bracelet"),
  ...baseShape,
  lengthCm: positiveNumberString("Length"),
  claspType: z.string().min(1, "Select a clasp type"),
});

export const PRODUCT_SCHEMAS = {
  earrings: earringsSchema,
  ring: ringSchema,
  pendant: pendantSchema,
  necklace: necklaceSchema,
  bracelet: braceletSchema,
} satisfies Record<ProductType, z.ZodTypeAny>;

export type EarringsFormValues = z.infer<typeof earringsSchema>;
export type RingFormValues = z.infer<typeof ringSchema>;
export type PendantFormValues = z.infer<typeof pendantSchema>;
export type NecklaceFormValues = z.infer<typeof necklaceSchema>;
export type BraceletFormValues = z.infer<typeof braceletSchema>;

export type ProductFormValues =
  | EarringsFormValues
  | RingFormValues
  | PendantFormValues
  | NecklaceFormValues
  | BraceletFormValues;

// ── Dynamic field configuration ─────────────────────────────────────────────
// Everything the form needs to render the type-specific fields, driven off
// one table instead of five near-duplicate form components.

export type ExtraFieldConfig =
  | { name: string; label: string; type: "number"; step: string; suffix?: string }
  | { name: string; label: string; type: "select"; options: readonly string[] }
  | { name: string; label: string; type: "switch" };

export const EXTRA_FIELDS: Record<ProductType, ExtraFieldConfig[]> = {
  earrings: [
    { name: "lengthCm", label: "Length (cm)", type: "number", step: "any" },
    { name: "widthCm", label: "Width (cm)", type: "number", step: "any" },
    { name: "hookType", label: "Hook Type", type: "select", options: HOOK_TYPE_OPTIONS },
  ],
  ring: [
    { name: "ringSize", label: "Ring Size (optional)", type: "select", options: RING_SIZE_OPTIONS },
    { name: "bandWidthMm", label: "Band Width (mm, optional)", type: "number", step: "any" },
  ],
  pendant: [
    { name: "lengthCm", label: "Length (cm)", type: "number", step: "any" },
    { name: "widthCm", label: "Width (cm)", type: "number", step: "any" },
    { name: "chainIncluded", label: "Chain Included", type: "switch" },
  ],
  necklace: [
    { name: "lengthCm", label: "Length (cm)", type: "number", step: "any" },
    { name: "claspType", label: "Clasp Type", type: "select", options: CLASP_TYPE_OPTIONS },
  ],
  bracelet: [
    { name: "lengthCm", label: "Length (cm)", type: "number", step: "any" },
    { name: "claspType", label: "Clasp Type", type: "select", options: CLASP_TYPE_OPTIONS },
  ],
};

export function defaultValuesFor(productType: ProductType) {
  const base = {
    productType,
    frontPhoto: undefined,
    sidePhoto: undefined,
    wornPhoto: undefined,
    weightGrams: "",
    finish: "",
    stone: "",
    collections: [] as string[],
    inventory: "",
    status: "draft" as const,
  };

  switch (productType) {
    case "earrings":
      return { ...base, lengthCm: "", widthCm: "", hookType: "" };
    case "ring":
      return { ...base, ringSize: "", bandWidthMm: "" };
    case "pendant":
      return { ...base, lengthCm: "", widthCm: "", chainIncluded: false };
    case "necklace":
      return { ...base, lengthCm: "", claspType: "" };
    case "bracelet":
      return { ...base, lengthCm: "", claspType: "" };
  }
}
