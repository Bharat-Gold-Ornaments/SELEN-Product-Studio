export type ProductType =
  | "earrings"
  | "ring"
  | "pendant"
  | "necklace"
  | "bracelet";

export type ProductStatus = "draft" | "processing" | "publishing" | "published" | "failed";

export type ImageCategory = "hero" | "lifestyle" | "closeup";

/** Fields common to every product type. */
export interface BaseProductFields {
  productId: string;
  productType: ProductType;
  title: string;
  weightGrams: number;
  finish: string;
  stone: string;
  collections: string[];
  inventory: number;
  status: ProductStatus;
}

export interface EarringsFields extends BaseProductFields {
  productType: "earrings";
  lengthCm: number;
  widthCm: number;
  hookType: string;
}

export interface RingFields extends BaseProductFields {
  productType: "ring";
  ringSize: string;
  bandWidthMm: number;
}

export interface PendantFields extends BaseProductFields {
  productType: "pendant";
  lengthCm: number;
  widthCm: number;
  chainIncluded: boolean;
}

export interface NecklaceFields extends BaseProductFields {
  productType: "necklace";
  lengthCm: number;
  claspType: string;
}

export interface BraceletFields extends BaseProductFields {
  productType: "bracelet";
  lengthCm: number;
  claspType: string;
}

export type ProductFields =
  | EarringsFields
  | RingFields
  | PendantFields
  | NecklaceFields
  | BraceletFields;

/**
 * Row shape mirrored from the Google Sheet — the source of truth for a
 * product (see services/google-sheets.ts). Every type-specific field across
 * all 5 product types gets its own nullable column so nothing is lost
 * regardless of which type a row represents — a ring row has ringSize +
 * bandWidthMm set and lengthCm/widthCm/hookType/claspType/chainIncluded
 * null, and so on.
 */
export interface ProductRecord {
  productId: string;
  category: ProductType;
  title: string;
  description: string;
  /** Comma-separated Shopify tags, AI-generated at Review (Milestone 7). Empty until copy is generated and saved. */
  tags: string[];
  /** AI-generated SEO title (<=60 chars). Empty until copy is generated and saved. */
  seoTitle: string;
  /** AI-generated meta description (~150-160 chars). Empty until copy is generated and saved. */
  metaDescription: string;
  weightGrams: number;
  lengthCm: number | null;
  widthCm: number | null;
  finish: string;
  stone: string;
  hookType: string | null;
  ringSize: string | null;
  bandWidthMm: number | null;
  claspType: string | null;
  chainIncluded: boolean | null;
  collections: string[];
  inventory: number;
  /** Set at Finalize (Milestone 9) — nothing upstream of Finalize collects a price. Zero until then. */
  price: number;
  status: ProductStatus;
  driveFolder: string;
  heroImageLink: string;
  lifestyleImageLink: string;
  closeupImageLink: string;
  createdDate: string;
  shopifyProductId: string | null;
  // ── Pricing Dashboard fields (see src/lib/pricing.ts) ────────────────────
  // `weightGrams` above doubles as Gross Weight — the two were the same
  // concept even before this feature, so it wasn't renamed/duplicated, only
  // reinterpreted. `netWeightGrams` is new: metal-only weight, excluding any
  // set stones/pearls. 0 (not null) is the "not yet entered" state for both
  // number fields here, matching every other numeric ProductRecord field.
  netWeightGrams: number;
  makingChargeMode: "flat" | "per_gram";
  makingChargeValue: number;
  /** JSON-serialized StoneLineItem[] (see src/lib/pricing.ts) — Sheets has no native array-of-objects column type. Empty string/array when Case A (no separate stone pricing). */
  stoneLineItems: string;
  manualPriceOverride: boolean;
  /** "synced" once `price` has been successfully pushed to Shopify, "out_of_sync" if a push failed, "" before the product is ever published. */
  priceSyncStatus: "synced" | "out_of_sync" | "";
  priceSyncedAt: string;
}
