import { PRODUCT_TYPES } from "@/lib/constants";
import type { ProductFormValues } from "@/lib/product-schemas";
import type { ProductRecord, ProductType } from "@/types/product";

export interface ImagePromptVariables {
  productType: string;
  finish: string;
  stone: string;
  dimensions: string;
  collections: string;
}

/**
 * Ring size and band width are both optional on the form (see
 * product-schemas.ts), so this can't just interpolate blindly the way the
 * other product types' dimension strings do — an empty value would leave a
 * dangling "size , mm band" in the image prompt. Falls back to a plain-
 * English placeholder when neither is set, since the templates always
 * expect *something* to fill {{dimensions}}.
 */
function formatRingDimensions(ringSize: string, bandWidthMm: string): string {
  const size = ringSize.trim();
  const band = bandWidthMm.trim();
  if (size && band) return `size ${size}, ${band}mm band`;
  if (size) return `size ${size}`;
  if (band) return `${band}mm band`;
  return "an unspecified size";
}

function formatDimensions(values: ProductFormValues): string {
  switch (values.productType) {
    case "earrings":
    case "pendant":
      return `${values.lengthCm}cm x ${values.widthCm}cm`;
    case "ring":
      return formatRingDimensions(values.ringSize, values.bandWidthMm);
    case "necklace":
    case "bracelet":
      return `${values.lengthCm}cm, ${values.claspType}`;
  }
}

// ProductRecord (a row loaded back from Google Sheets) isn't a discriminated
// union like ProductFormValues — every field lives on every row, nulled out
// for whichever product type doesn't use it — so this switches on `category`
// directly instead of reusing formatDimensions above.
function formatDimensionsFromRecord(record: ProductRecord): string {
  switch (record.category) {
    case "earrings":
    case "pendant":
      return `${record.lengthCm}cm x ${record.widthCm}cm`;
    case "ring":
      return formatRingDimensions(record.ringSize ?? "", record.bandWidthMm != null ? String(record.bandWidthMm) : "");
    case "necklace":
    case "bracelet":
      return `${record.lengthCm}cm, ${record.claspType}`;
  }
}

function typeLabel(productType: ProductType): string {
  return PRODUCT_TYPES.find((t) => t.value === productType)?.label ?? productType;
}

/**
 * Flattens a validated Create Product submission into the plain
 * string variables the Hero/Lifestyle/Closeup templates expect.
 * Kept separate from the Leonardo service so that service stays agnostic
 * of the product form's shape.
 */
export function buildImagePromptVariables(values: ProductFormValues): ImagePromptVariables {
  return {
    productType: typeLabel(values.productType),
    finish: values.finish,
    stone: values.stone,
    dimensions: formatDimensions(values),
    collections: values.collections.length > 0 ? values.collections.join(", ") : "none",
  };
}

/**
 * Same flattening, from a Google Sheets row instead of a live form
 * submission — used to rebuild the Review screen's prompt variables (for
 * Regenerate) when reloading an already-generated product that no longer
 * has an in-memory session. See app/api/products/[productId]/review/route.ts.
 */
export function buildImagePromptVariablesFromRecord(record: ProductRecord): ImagePromptVariables {
  return {
    productType: typeLabel(record.category),
    finish: record.finish,
    stone: record.stone,
    dimensions: formatDimensionsFromRecord(record),
    collections: record.collections.length > 0 ? record.collections.join(", ") : "none",
  };
}
