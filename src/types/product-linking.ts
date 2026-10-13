import type { InventoryCategory } from "@/types/inventory";
import type { ProductType } from "@/types/product";

/**
 * One physical piece a product sells, to be linked to its Inventory SKU:
 * the product itself when it has no variants, otherwise one per variant.
 */
export interface LinkSlot {
  /** "main" for a product without variants; the variant row id otherwise. */
  key: string;
  /** "Default" or "Rose Gold / 16". */
  label: string;
  color: string;
  size: string;
  /** The SKU it's linked to now, or "". */
  currentSku: string;
  /** A likely SKU, when there's a good reason to think it's this piece. */
  suggestedSku: string;
  suggestionReason: string;
  /** A name for a new SKU, when this piece isn't in Inventory: e.g. ESA011-RG. "" when there's nothing to base it on. */
  newSkuSuggestion: string;
  /** What the product currently prices this piece on. */
  studioGrossWeight: number;
  studioQuantity: number;
  /** Shopify's stock and SKU for this piece; null when it isn't on Shopify. */
  shopifyQuantity: number | null;
  shopifySku: string;
  /** For a new SKU's photo: the variant's own gallery, else the product's photos. */
  photoUrl: string;
}

export interface LinkProduct {
  productId: string;
  title: string;
  category: ProductType;
  shopifyProductId: string | null;
  photoUrl: string;
  /** True when it sells Color/Size variants (one slot each). */
  hasVariants: boolean;
  slots: LinkSlot[];
}

export interface LinkingOverview {
  products: LinkProduct[];
}

/** How to link one slot. */
export interface SlotLinkInput {
  slotKey: string;
  /** An existing Inventory SKU — or, with `create`, the new SKU to add. */
  sku: string;
  /** When the piece isn't in Inventory yet: add it, from the product's data. */
  create?: { category: InventoryCategory };
  /** Which gross weight is right when Inventory and the product differ. */
  weight: "inventory" | "studio";
  /** Which stock count is right when Inventory and Shopify differ. */
  stock: "inventory" | "shopify";
}

export interface LinkProductInput {
  productId: string;
  links: SlotLinkInput[];
}

export interface LinkProductResult {
  linked: number;
  /** Problems that didn't stop the link, for a person to look at. */
  warnings: string[];
}
