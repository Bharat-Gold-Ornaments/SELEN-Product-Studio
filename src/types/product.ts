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
}
