import { computeFinalPrice, type MakingChargeMode, type StoneLineItem } from "@/lib/pricing";
import type { ImageCategory } from "@/types/product";

/**
 * One Color/Size combination of a product, each with its own stock and
 * (optionally) its own price and photo. ProductRecord.variants stores an
 * array of these as a JSON string — Sheets has no native array-of-objects
 * column type, same reasoning as StoneLineItem in src/lib/pricing.ts.
 */
export interface VariantRow {
  /** Client-generated id for React keys/editing — never persisted as a meaningful identifier beyond this product's own list. */
  id: string;
  /** "" means this product doesn't use a Color option at all. */
  color: string;
  /** "" means this product doesn't use a Size option at all. */
  size: string;
  /** true = inherit the product's main computed price as-is (resolved via resolveVariantPrice, never baked in at save time so it can't go stale if the main price changes later). false = this variant computes its own price from grossWeightGrams/netWeightGrams below, via the exact same formula as the main Pricing panel (src/lib/pricing.ts's computeFinalPrice) — same rate/gram, making charge, and stone/pearl line items as the product itself; only the weight differs, since that's the one thing that genuinely varies by size. */
  sameAsMainPrice: boolean;
  /** Only meaningful when sameAsMainPrice is false. */
  grossWeightGrams: number;
  /** Only meaningful when sameAsMainPrice is false. */
  netWeightGrams: number;
  inventory: number;
  /** true = show the product's plain default photos, no dedicated gallery attached (Shopify falls back to the product's default images, same as every variant before this feature existed). false = this variant gets its own photo gallery — see VariantColorImageSet. Exclusive across rows in the UI (see VariantsTable) — only one variant at a time uses the default images. */
  useDefaultImages: boolean;
}

/**
 * Normalizes one parsed row to the current VariantRow shape. This field's
 * price representation changed once already (a flat `price: number | null`
 * became `sameAsMainPrice`/`grossWeightGrams`/`netWeightGrams`) — an already
 * -saved row from before that change has no weight to recover a custom price
 * from, so it's mapped to `sameAsMainPrice: true` rather than left with a
 * missing/broken shape. Same "old data self-heals on next read instead of
 * crashing" discipline as normalizeColorImageSet below.
 */
function normalizeVariantRow(entry: unknown): VariantRow {
  const raw = (entry ?? {}) as Partial<VariantRow> & { price?: number | null };
  const hasWeights = typeof raw.grossWeightGrams === "number" && typeof raw.netWeightGrams === "number";
  return {
    id: typeof raw.id === "string" ? raw.id : crypto.randomUUID(),
    color: typeof raw.color === "string" ? raw.color : "",
    size: typeof raw.size === "string" ? raw.size : "",
    sameAsMainPrice: hasWeights ? Boolean(raw.sameAsMainPrice) : true,
    grossWeightGrams: hasWeights ? (raw.grossWeightGrams as number) : 0,
    netWeightGrams: hasWeights ? (raw.netWeightGrams as number) : 0,
    inventory: typeof raw.inventory === "number" ? raw.inventory : 0,
    useDefaultImages: Boolean(raw.useDefaultImages),
  };
}

/** ProductRecord.variants is stored as a JSON string — this is the one canonical parse used by both the client panel and the server routes, so the two can never silently disagree on the format. Malformed/empty input parses to an empty list (== "no variants") rather than throwing. */
export function parseVariantRows(json: string): VariantRow[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.map(normalizeVariantRow) : [];
  } catch {
    return [];
  }
}

export function serializeVariantRows(rows: VariantRow[]): string {
  return JSON.stringify(rows);
}

export interface VariantPricingContext {
  ratePerGram: number;
  makingChargeMode: MakingChargeMode;
  makingChargeValue: number;
  stoneLineItems: StoneLineItem[];
}

/**
 * A row's actual price to send to Shopify. "Same as main" inherits the
 * product's main computed price as-is; otherwise it's computed fresh from
 * this row's own weight via the same formula/rate/making-charge/stones as
 * the product itself — never cached/baked in ahead of time, so a later
 * change to the rate or making charge is always reflected.
 */
export function resolveVariantPrice(row: VariantRow, mainPrice: number, pricing: VariantPricingContext): number {
  if (row.sameAsMainPrice) return mainPrice;
  return computeFinalPrice({
    grossWeightGrams: row.grossWeightGrams,
    netWeightGrams: row.netWeightGrams,
    ratePerGram: pricing.ratePerGram,
    makingChargeMode: pricing.makingChargeMode,
    makingChargeValue: pricing.makingChargeValue,
    stoneLineItems: pricing.stoneLineItems,
  });
}

export function totalVariantInventory(rows: VariantRow[]): number {
  return rows.reduce((sum, row) => sum + row.inventory, 0);
}

/**
 * Hard validation: Shopify requires every variant of a product to declare a
 * value for every option the product declares — a product can't have Color
 * on some variants and not others. Returns the first violated rule's
 * message, or null if `rows` is save-ready. Shared between the client panel
 * (instant feedback) and the server route (never trusts the client alone),
 * same pattern as validatePricingInputs in src/lib/pricing.ts.
 */
export function validateVariantRows(rows: VariantRow[]): string | null {
  if (rows.length === 0) return null;

  const anyColor = rows.some((row) => row.color.trim() !== "");
  const anySize = rows.some((row) => row.size.trim() !== "");

  if (anyColor && rows.some((row) => row.color.trim() === "")) {
    return "Every variant needs a Color, since at least one variant has one set.";
  }
  if (anySize && rows.some((row) => row.size.trim() === "")) {
    return "Every variant needs a Size, since at least one variant has one set.";
  }
  if (!anyColor && !anySize) {
    return "Each variant needs a Color and/or a Size — otherwise there's nothing to tell them apart.";
  }
  for (const row of rows) {
    if (!(row.inventory >= 0) || !Number.isInteger(row.inventory)) {
      return "Stock must be a whole number, 0 or greater, for every variant.";
    }
    if (!row.sameAsMainPrice) {
      if (!(row.grossWeightGrams > 0)) {
        return "A variant with a custom price needs a Gross weight greater than 0.";
      }
      if (!(row.netWeightGrams > 0)) {
        return "A variant with a custom price needs a Net weight greater than 0.";
      }
      if (row.netWeightGrams > row.grossWeightGrams) {
        return "A variant's Net weight can't be greater than its Gross weight.";
      }
    }
  }

  const seen = new Set<string>();
  for (const row of rows) {
    const key = `${row.color.trim().toLowerCase()}::${row.size.trim().toLowerCase()}`;
    if (seen.has(key)) {
      return "Two variants have the same Color/Size combination — each must be unique.";
    }
    seen.add(key);
  }

  return null;
}

// ── Per-color photo galleries ────────────────────────────────────────────
// A variant whose Color matches the product's own Default Finish always
// shows the product's existing hero/lifestyle/closeup photos directly — see
// VariantsPanel. Every *other* color gets its own open-ended photo gallery
// here, keyed by color name — any number of photos, mixing AI-generated and
// manually-uploaded. ProductRecord.variantColorImages stores an array of
// these as a JSON string, same reasoning as VariantRow above.

export interface VariantColorImage {
  /** Client-generated id for React keys/removal — never persisted as a meaningful identifier beyond this product's own list. */
  id: string;
  /** Drive image-proxy link — downloaded/staged to Shopify the same way as every other picked photo in this app. */
  url: string;
  source: "generated" | "manual";
  /** Which AI generation pass produced this (Hero/Lifestyle/Closeup) — informational only now, not a fixed slot; unset for a manually-uploaded photo. */
  category?: ImageCategory;
}

export interface VariantColorImageSet {
  color: string;
  images: VariantColorImage[];
  status: "generating" | "ready" | "failed";
  error?: string;
  /** True if the active image model had no image-to-image support when this was generated (e.g. Ideogram 3.0) — these are then a fresh reinterpretation, not a true recolor of the default variant's photo. Surfaced as a UI warning, never blocks. */
  usedTextToImageFallback?: boolean;
}

const VALID_COLOR_IMAGE_SET_STATUSES = ["generating", "ready", "failed"] as const;

/**
 * Normalizes one parsed entry to the current VariantColorImageSet shape —
 * in particular, always guarantees `images` is a real array. This field's
 * JSON shape changed once already (from 3 fixed hero/lifestyle/closeup
 * links to this open `images` list); a Sheet cell written under the old
 * shape before that change would otherwise deserialize with `images`
 * missing entirely, and every reader assuming `.images` is always an array
 * (e.g. VariantsPanel's `.images.length` checks) would throw on it. Doing
 * the normalizing once here, rather than adding `?.` at every call site,
 * means old rows self-heal on next read instead of crashing.
 */
function normalizeColorImageSet(entry: unknown): VariantColorImageSet {
  const raw = (entry ?? {}) as Partial<VariantColorImageSet> & { images?: unknown };
  return {
    color: typeof raw.color === "string" ? raw.color : "",
    images: Array.isArray(raw.images) ? (raw.images as VariantColorImage[]) : [],
    status: VALID_COLOR_IMAGE_SET_STATUSES.includes(raw.status as (typeof VALID_COLOR_IMAGE_SET_STATUSES)[number])
      ? (raw.status as VariantColorImageSet["status"])
      : "failed",
    error: typeof raw.error === "string" ? raw.error : undefined,
    usedTextToImageFallback: typeof raw.usedTextToImageFallback === "boolean" ? raw.usedTextToImageFallback : undefined,
  };
}

export function parseVariantColorImages(json: string): VariantColorImageSet[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.map(normalizeColorImageSet) : [];
  } catch {
    return [];
  }
}

export function serializeVariantColorImages(sets: VariantColorImageSet[]): string {
  return JSON.stringify(sets);
}

/** Every distinct non-default Color across `rows` that has its own gallery (not using default images) — these are the only colors that need their photos staged to Shopify (see loadVariantColorShopifyImages in shopify-listing.ts). A row left on "Use default images" needs nothing staged for its own color. */
export function colorsNeedingGeneratedImages(rows: VariantRow[], defaultColor: string): string[] {
  const normalizedDefault = defaultColor.trim().toLowerCase();
  const seen = new Set<string>();
  const result: string[] = [];
  for (const row of rows) {
    const color = row.color.trim();
    if (!color || row.useDefaultImages || color.toLowerCase() === normalizedDefault) continue;
    const key = color.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(color);
    }
  }
  return result;
}

export function findVariantColorImageSet(
  sets: VariantColorImageSet[],
  color: string
): VariantColorImageSet | undefined {
  const normalized = color.trim().toLowerCase();
  return sets.find((set) => set.color.trim().toLowerCase() === normalized);
}

/** A URL-safe, human-legible folder name for a color — e.g. "Rose Gold" -> "rose-gold" — used as the Drive subfolder name under a product's `generated/` folder. */
export function colorSlug(color: string): string {
  return color
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "color";
}

// ── Storefront compatibility ─────────────────────────────────────────────
// selen-sparkle-shop (the storefront) reads a color's full photo gallery
// from one of 3 fixed product metafields, not from Shopify's native
// per-variant image — see src/lib/colorOption.ts's COLOR_SWATCHES and
// getColorGallery in that same repo. Matches FINISH_OPTIONS in
// product-schemas.ts exactly, since Default Finish is already locked to
// these same 3 values.
export const COLOR_GALLERY_METAFIELD_KEYS: Record<string, string> = {
  "yellow gold": "gallery_yellow_gold",
  "rose gold": "gallery_rose_gold",
  silver: "gallery_silver",
};

/** The storefront's gallery metafield key for a color, or undefined if it's not one of the 3 canonical metals the storefront recognizes — such a color simply gets no metafield written, same "silently skip a no-match" stance as resolveCategoryId in services/shopify.ts. */
export function colorGalleryMetafieldKey(color: string): string | undefined {
  return COLOR_GALLERY_METAFIELD_KEYS[color.trim().toLowerCase()];
}

/**
 * Indian ring sizes selen-sparkle-shop's own size selector actually renders
 * as pickable buttons — see RING_SIZE_DISPLAY_RANGE in that repo's
 * lib/ringSize.ts. The storefront shows this exact fixed button row
 * regardless of which sizes a ring really has variants for; a variant sized
 * outside this list would be created on Shopify but have no button to
 * select it with, effectively unreachable. Only Size (not Color) is
 * ring-specific — every other product type (earrings, pendant, necklace,
 * bracelet) never shows a Size option at all, see VariantsTable.
 */
export const RING_SIZE_OPTIONS = ["8", "10", "12", "14", "16", "18"] as const;
