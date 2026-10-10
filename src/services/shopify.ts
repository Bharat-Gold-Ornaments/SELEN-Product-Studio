import "server-only";
import { randomUUID } from "node:crypto";
import { requireEnv, optionalEnv } from "@/lib/env";
import { colorGalleryMetafieldKey } from "@/lib/variants";
import type { ImageCategory } from "@/types/product";

// ── Config ───────────────────────────────────────────────────────────────

// Bumped periodically as Shopify releases new quarterly API versions —
// 2026-07 was the current one when this was written. An old-but-still-
// supported version keeps working (Shopify supports each release for a
// year), so this only needs attention if requests start getting
// deprecation warnings/errors.
const API_VERSION = optionalEnv("SHOPIFY_API_VERSION", "2026-07");
// Every product this app creates is attributed to this single brand — it's
// the only vendor SELEN Product Studio ever publishes as. Hardcoded rather
// than configurable since this is a single-tenant, single-brand tool.
const VENDOR = "SELEN";

function storeDomain(): string {
  return requireEnv("SHOPIFY_STORE_DOMAIN");
}

// ── Auth ─────────────────────────────────────────────────────────────────
// As of January 1, 2026, Shopify no longer issues the old-style permanent
// "shpat_..." token for newly created custom apps — that path (Settings >
// Apps > Develop apps, creating an app directly in the admin) is legacy-only
// now, kept working solely for apps that already existed before the cutover.
// Every new app is created in the separate Dev Dashboard instead, and those
// apps authenticate via the OAuth "client credentials" grant: exchange a
// client id + secret for an access token that's only valid for 24 hours
// (`expires_in: 86399`, always), then repeat the exchange to get a new one.
// There is no way to get a non-expiring token for a new app anymore.
// https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/client-credentials-grant
//
// getAccessToken() below hides all of this from every caller in this file —
// they just await it and get a currently-valid token, the same way they'd
// read a static env var. Cached per server instance (same caveat as
// getPrimaryLocationId below: a fresh serverless cold start re-fetches,
// which is fine, it's a cheap call), refreshed 60s before actual expiry so
// a request never lands exactly as the old token dies mid-flight.
let cachedToken: { value: string; expiresAt: number } | null = null;
const TOKEN_REFRESH_BUFFER_MS = 60_000;

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt - TOKEN_REFRESH_BUFFER_MS > Date.now()) {
    return cachedToken.value;
  }

  const res = await fetch(`https://${storeDomain()}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: requireEnv("SHOPIFY_CLIENT_ID"),
      client_secret: requireEnv("SHOPIFY_CLIENT_SECRET"),
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Shopify token request failed ${res.status}: ${body || res.statusText}`);
  }

  const body = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { value: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
  return cachedToken.value;
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: { message: string }[];
}

/**
 * Every Shopify Admin API call in this file goes through here — same
 * one-function-per-integration shape as leonardoFetch in services/
 * leonardo.ts and shopifyGraphQL below is the only place that knows the
 * request/auth shape. `errors` (top-level GraphQL errors — malformed query,
 * bad auth, etc.) throws; `userErrors` (a mutation succeeding at the
 * transport level but rejecting the input — e.g. "Price can't be
 * negative") is each mutation's own concern to check, since the shape and
 * meaning of those differs per mutation.
 */
async function shopifyGraphQL<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await fetch(`https://${storeDomain()}/admin/api/${API_VERSION}/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": await getAccessToken(),
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Shopify API error ${res.status}: ${body || res.statusText}`);
  }

  const body = (await res.json()) as GraphQLResponse<T>;
  if (body.errors && body.errors.length > 0) {
    throw new Error(`Shopify API error: ${body.errors.map((e) => e.message).join("; ")}`);
  }
  if (!body.data) {
    throw new Error("Shopify API returned no data.");
  }
  return body.data;
}

function assertNoUserErrors(userErrors: { field?: string[] | null; message: string }[], context: string): void {
  if (userErrors.length === 0) return;
  throw new Error(`Shopify ${context}: ${userErrors.map((e) => e.message).join("; ")}`);
}

/**
 * Proof the client id/secret exchange works AND the resulting token can
 * actually query the store — `getAccessToken()` alone would only prove the
 * credentials are valid, not that SHOPIFY_STORE_DOMAIN or SHOPIFY_API_VERSION
 * are right, so this pairs the token exchange with one minimal query. Used
 * by Settings' Integration Status panel.
 */
export async function checkShopifyConnection(): Promise<void> {
  await shopifyGraphQL<{ shop: { name: string } }>(`query { shop { name } }`, {});
}

// ── Inventory location ───────────────────────────────────────────────────

let cachedLocationId: string | null = null;

/**
 * Every variant needs a location to hold its inventory count. Real stores
 * can have several (warehouse, retail floor, etc.); this tool has no UI for
 * picking one, so it just uses whichever comes back first — fine for a
 * single-location jewellery brand, worth revisiting if that ever changes.
 * Cached per server instance since a store's locations essentially never
 * change between requests.
 */
async function getPrimaryLocationId(): Promise<string> {
  if (cachedLocationId) return cachedLocationId;

  const data = await shopifyGraphQL<{ locations: { nodes: { id: string }[] } }>(
    `query { locations(first: 1) { nodes { id } } }`,
    {}
  );
  const id = data.locations.nodes[0]?.id;
  if (!id) {
    throw new Error("Shopify store has no locations configured — can't set inventory without one.");
  }
  cachedLocationId = id;
  return id;
}

// ── Sales channel publishing ────────────────────────────────────────────
// productSet has no field for this — a product it creates starts published
// to zero sales channels, invisible everywhere (Online Store, POS, etc.)
// until someone opens it in Shopify admin and toggles channels on by hand.
// This makes that automatic. Requires read_publications + write_publications
// scopes on top of everything else this file already needs.

let cachedPublicationIds: string[] | null = null;

/** Every sales channel/publication on the store — cached per server instance, same reasoning as getPrimaryLocationId. */
async function getAllPublicationIds(): Promise<string[]> {
  if (cachedPublicationIds) return cachedPublicationIds;

  const data = await shopifyGraphQL<{ publications: { nodes: { id: string }[] } }>(
    `query { publications(first: 250) { nodes { id } } }`,
    {}
  );
  const ids = data.publications.nodes.map((n) => n.id);
  cachedPublicationIds = ids;
  return ids;
}

/**
 * Publishes a product to every sales channel on the store in one call.
 * Best-effort, same as setProductSeo below — the product already exists by
 * the time this runs, so a failure here (e.g. scopes not granted yet)
 * shouldn't be reported as the whole publish failing, just logged; the
 * product just needs its channels turned on by hand in Shopify admin until
 * this succeeds.
 */
async function publishToAllChannels(productId: string): Promise<void> {
  const publicationIds = await getAllPublicationIds();
  if (publicationIds.length === 0) return;

  const data = await shopifyGraphQL<{
    publishablePublish: {
      userErrors: { field?: string[] | null; message: string }[];
    };
  }>(
    `mutation publishToChannels($id: ID!, $input: [PublicationInput!]!) {
      publishablePublish(id: $id, input: $input) {
        userErrors { field message }
      }
    }`,
    { id: productId, input: publicationIds.map((publicationId) => ({ publicationId })) }
  );
  assertNoUserErrors(data.publishablePublish.userErrors, "publishablePublish");
}

// ── Collections ──────────────────────────────────────────────────────────

let cachedCollections: { id: string; title: string }[] | null = null;

/**
 * Every collection on the store — used to let the Review screen's AI
 * collection classifier (services/anthropic-copy.ts) pick from real,
 * existing collection names instead of inventing ones that don't exist.
 * Cached per server instance, same reasoning as getPrimaryLocationId and
 * getAllPublicationIds above: a store's collection list doesn't change
 * mid-session often enough to justify re-querying on every classification.
 */
export async function listCollections(): Promise<{ id: string; title: string }[]> {
  if (cachedCollections) return cachedCollections;

  const data = await shopifyGraphQL<{ collections: { nodes: { id: string; title: string }[] } }>(
    `query { collections(first: 250) { nodes { id title } } }`,
    {}
  );
  cachedCollections = data.collections.nodes;
  return cachedCollections;
}

/**
 * Resolves real collection titles (from the sheet's `collections` column —
 * AI-classified via services/anthropic-copy.ts's classifyCollections, or
 * hand-edited on Review) to their Shopify collection ids, for productSet's
 * `collections` input field below. Matches case-insensitively since Claude's
 * classification is instructed to echo the list verbatim but a hand-edit
 * could differ in casing; any title that doesn't match a real collection is
 * silently dropped (not erroring) so a stray/renamed title never blocks the
 * rest of publishing.
 */
async function resolveCollectionIds(titles: string[]): Promise<string[]> {
  if (titles.length === 0) return [];
  const collections = await listCollections();
  const lookup = new Map(collections.map((c) => [c.title.toLowerCase(), c.id]));
  const ids: string[] = [];
  for (const title of titles) {
    const id = lookup.get(title.trim().toLowerCase());
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

// ── Discounts ────────────────────────────────────────────────────────────
// Backs the Discounts tab: apply or remove a percentage discount across the
// whole catalog, one collection, or one tag. Unlike the Pricing Dashboard
// sync above (which only ever touches a product's single default variant),
// a discount must reach every variant of every matching product, since
// products here can have color/size variants.

export type DiscountScope =
  | { type: "global" }
  | { type: "collection"; collectionId: string }
  | { type: "tag"; tag: string };

interface ScopeVariant {
  id: string;
  price: string;
  compareAtPrice: string | null;
}

interface ScopeProduct {
  id: string;
  title: string;
  variants: ScopeVariant[];
}

let cachedTags: string[] | null = null;

/**
 * Every distinct tag in use across active products — there's no dedicated
 * "list all tags" field in the Admin API, so this aggregates `tags` off a
 * best-effort scan of up to 250 active products (matches this store's full
 * catalog size). Powers the Discounts tab's tag picker. Cached per server
 * instance, same reasoning as listCollections above.
 */
export async function listAllTags(): Promise<string[]> {
  if (cachedTags) return cachedTags;

  const data = await shopifyGraphQL<{ products: { nodes: { tags: string[] }[] } }>(
    `query { products(first: 250, query: "-status:archived") { nodes { tags } } }`,
    {}
  );
  const tags = new Set<string>();
  for (const node of data.products.nodes) {
    for (const tag of node.tags) tags.add(tag);
  }
  cachedTags = Array.from(tags).sort((a, b) => a.localeCompare(b));
  return cachedTags;
}

/** Escapes a value for Shopify's quoted search-query syntax (`tag:'...'`). */
function escapeSearchQueryValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

const SCOPE_PRODUCT_FIELDS = `
  id
  title
  variants(first: 50) {
    nodes { id price compareAtPrice }
  }
`;

/** Raw shape of one product node as the queries below actually return it — variants nested under `.nodes`. */
interface ScopeProductNode {
  id: string;
  title: string;
  variants: { nodes: ScopeVariant[] };
}

function flattenScopeProduct(node: ScopeProductNode): ScopeProduct {
  return { id: node.id, title: node.title, variants: node.variants.nodes };
}

/**
 * Every product (and every one of its variants) matching a discount scope.
 * `global` and `tag` both search the flat product list (Shopify's search
 * syntax handles `-status:archived AND tag:'x'` directly); `collection`
 * instead walks that collection's own `products` connection, since
 * collection membership isn't expressible as a `products(query:)` filter.
 */
export async function resolveScopeVariants(scope: DiscountScope): Promise<ScopeProduct[]> {
  if (scope.type === "collection") {
    const data = await shopifyGraphQL<{
      collection: { products: { nodes: ScopeProductNode[] } } | null;
    }>(
      `query getCollectionProducts($id: ID!) {
        collection(id: $id) {
          products(first: 250) {
            nodes { ${SCOPE_PRODUCT_FIELDS} }
          }
        }
      }`,
      { id: scope.collectionId }
    );
    return (data.collection?.products.nodes ?? []).map(flattenScopeProduct);
  }

  const query =
    scope.type === "tag"
      ? `-status:archived AND tag:'${escapeSearchQueryValue(scope.tag)}'`
      : "-status:archived";

  const data = await shopifyGraphQL<{ products: { nodes: ScopeProductNode[] } }>(
    `query getScopeProducts($query: String!) {
      products(first: 250, query: $query) {
        nodes { ${SCOPE_PRODUCT_FIELDS} }
      }
    }`,
    { query }
  );
  return data.products.nodes.map(flattenScopeProduct);
}

export interface DiscountResult {
  productsUpdated: number;
  variantsUpdated: number;
  failed: { productId: string; message: string }[];
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

async function bulkUpdateVariants(
  productId: string,
  variants: { id: string; price: number; compareAtPrice: number | null }[]
): Promise<void> {
  const data = await shopifyGraphQL<{
    productVariantsBulkUpdate: { userErrors: { field?: string[] | null; message: string }[] };
  }>(
    `mutation applyDiscount($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
      productVariantsBulkUpdate(productId: $productId, variants: $variants) {
        userErrors { field message }
      }
    }`,
    { productId, variants }
  );
  assertNoUserErrors(data.productVariantsBulkUpdate.userErrors, "productVariantsBulkUpdate (discount)");
}

/**
 * Applies a percent-off discount to every variant in scope. Rebases off each
 * variant's true original price (`compareAtPrice` if it's already discounted,
 * otherwise its current `price`) rather than its current price, so re-running
 * this at a different percentage is never compounding — it always discounts
 * from the same original, not from an already-discounted price.
 */
export async function applyDiscountToScope(
  scope: DiscountScope,
  percent: number
): Promise<DiscountResult> {
  const products = await resolveScopeVariants(scope);
  let productsUpdated = 0;
  let variantsUpdated = 0;
  const failed: { productId: string; message: string }[] = [];

  for (const product of products) {
    try {
      const variantInputs = product.variants.map((variant) => {
        const original = variant.compareAtPrice ? Number(variant.compareAtPrice) : Number(variant.price);
        return {
          id: variant.id,
          price: round2(original * (1 - percent / 100)),
          compareAtPrice: original,
        };
      });
      await bulkUpdateVariants(product.id, variantInputs);
      productsUpdated++;
      variantsUpdated += variantInputs.length;
    } catch (error) {
      failed.push({
        productId: product.id,
        message: error instanceof Error ? error.message : "Unknown error.",
      });
    }
  }

  return { productsUpdated, variantsUpdated, failed };
}

/**
 * Reverses a discount: every variant in scope that currently has a
 * `compareAtPrice` gets its `price` restored to that value and its
 * `compareAtPrice` cleared. Variants with no `compareAtPrice` are left
 * untouched (nothing to remove) and don't count toward the totals.
 */
export async function removeDiscountFromScope(scope: DiscountScope): Promise<DiscountResult> {
  const products = await resolveScopeVariants(scope);
  let productsUpdated = 0;
  let variantsUpdated = 0;
  const failed: { productId: string; message: string }[] = [];

  for (const product of products) {
    const discounted = product.variants.filter((v) => v.compareAtPrice != null);
    if (discounted.length === 0) continue;

    try {
      const variantInputs = discounted.map((variant) => ({
        id: variant.id,
        price: Number(variant.compareAtPrice),
        compareAtPrice: null,
      }));
      await bulkUpdateVariants(product.id, variantInputs);
      productsUpdated++;
      variantsUpdated += variantInputs.length;
    } catch (error) {
      failed.push({
        productId: product.id,
        message: error instanceof Error ? error.message : "Unknown error.",
      });
    }
  }

  return { productsUpdated, variantsUpdated, failed };
}

// ── Image upload ─────────────────────────────────────────────────────────

export interface ShopifyImageInput {
  buffer: Buffer;
  mimeType: string;
  filename: string;
  alt: string;
  /** Which of hero/lifestyle/closeup this is — informational only (e.g. which AI generation pass produced a variant gallery photo); a manually-uploaded gallery photo has none. */
  category?: ImageCategory;
  /** Which variant Color this photo belongs to — omitted for the product's own base/default photos. Present entries get staged as variant-gallery media and attached to that color's variant(s) (see attachVariantGalleries below) instead of going into the product's plain `files` list. */
  color?: string;
}

/**
 * Uploads one image's bytes to Shopify's staging storage and returns the
 * `resourceUrl` to reference it from productSet's `files`/variant `file`
 * input. Necessary because that input wants a URL Shopify itself can fetch
 * from, and this app's generated/picked images only live behind its own
 * auth-gated proxy (`/api/drive-image/[fileId]`) — Shopify has no session
 * cookie to fetch that with. Same presigned-upload shape as Leonardo's
 * uploadReferenceImage in services/leonardo.ts: ask for an upload target
 * (stagedUploadsCreate), POST the file straight to it, then use the
 * returned handle in the next call.
 * https://shopify.dev/docs/apps/build/online-store/product-media
 */
async function stageImageUpload(image: ShopifyImageInput): Promise<string> {
  const data = await shopifyGraphQL<{
    stagedUploadsCreate: {
      stagedTargets: { url: string; resourceUrl: string; parameters: { name: string; value: string }[] }[];
      userErrors: { field?: string[] | null; message: string }[];
    };
  }>(
    `mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
      stagedUploadsCreate(input: $input) {
        stagedTargets { url resourceUrl parameters { name value } }
        userErrors { field message }
      }
    }`,
    {
      input: [
        {
          filename: image.filename,
          mimeType: image.mimeType,
          httpMethod: "POST",
          resource: "IMAGE",
          fileSize: String(image.buffer.length),
        },
      ],
    }
  );

  assertNoUserErrors(data.stagedUploadsCreate.userErrors, "stagedUploadsCreate");
  const target = data.stagedUploadsCreate.stagedTargets[0];
  if (!target) {
    throw new Error("Shopify did not return a staged upload target.");
  }

  const form = new FormData();
  for (const { name, value } of target.parameters) {
    form.append(name, value);
  }
  // Same Buffer -> Uint8Array -> Blob conversion as uploadReferenceImage in
  // leonardo.ts, for the same reason: Blob's DOM typing wants a plain
  // Uint8Array<ArrayBuffer>, and Uint8Array.from() guarantees a fresh,
  // non-shared backing buffer that satisfies it. The file field must be
  // appended last — Shopify's staging target is an S3-style presigned POST,
  // which (like S3 itself) requires the file field to come after every
  // other form field.
  const fileBytes = Uint8Array.from(image.buffer);
  form.append("file", new Blob([fileBytes], { type: image.mimeType }), image.filename);

  const uploadRes = await fetch(target.url, { method: "POST", body: form });
  if (!uploadRes.ok) {
    const body = await uploadRes.text().catch(() => "");
    throw new Error(`Shopify staged image upload failed ${uploadRes.status}: ${body || uploadRes.statusText}`);
  }

  return target.resourceUrl;
}

// ── Product category (Shopify's standard taxonomy) ──────────────────────
// productSet's `category` field wants a taxonomy category id (e.g.
// "Apparel & Accessories > Jewelry > Rings"), not a plain string — and
// hardcoding those ids would mean guessing at Shopify's actual taxonomy
// data, the same mistake that caused the optionValues/productOptions
// errors earlier. Looked up dynamically instead, via the `taxonomy.categories`
// search Shopify's API itself exposes, and cached per search term per
// server instance (a product type never resolves to a different category
// mid-session, so there's no reason to re-query for every product).

// Keyed by the exact label PRODUCT_TYPES produces (see lib/constants.ts) —
// input.productType is already that label by the time it reaches here (see
// api/products/[productId]/publish/route.ts). Search terms are the plural
// Shopify taxonomy actually uses; "Earrings" is already plural so it's
// unchanged.
const CATEGORY_SEARCH_TERM: Record<string, string> = {
  Earrings: "Earrings",
  Ring: "Rings",
  Pendant: "Pendants",
  Necklace: "Necklaces",
  Bracelet: "Bracelets",
};

const cachedCategoryIds = new Map<string, string | null>();

/**
 * Searches Shopify's taxonomy for `searchTerm` and returns the id of
 * whichever match's full path actually contains "Jewelry" — a plain search
 * for e.g. "Rings" can also match unrelated categories (curtain rings,
 * napkin rings, etc.), so this is how a wrong category never gets picked
 * silently. Returns null (not an error) if nothing under Jewelry matched;
 * callers treat that the same as "couldn't resolve" and just omit category
 * rather than blocking the publish over it.
 */
async function findJewelryCategoryId(searchTerm: string): Promise<string | null> {
  if (cachedCategoryIds.has(searchTerm)) return cachedCategoryIds.get(searchTerm)!;

  const data = await shopifyGraphQL<{
    taxonomy: { categories: { edges: { node: { id: string; fullName: string } }[] } };
  }>(
    `query findCategory($search: String!) {
      taxonomy {
        categories(search: $search, first: 20) {
          edges { node { id fullName } }
        }
      }
    }`,
    { search: searchTerm }
  );

  const match = data.taxonomy.categories.edges.find((edge) => edge.node.fullName.includes("Jewelry"));
  const id = match?.node.id ?? null;
  cachedCategoryIds.set(searchTerm, id);
  return id;
}

/**
 * Best-effort category resolution for one product — never throws, since a
 * product should still publish (just without a Category set) rather than
 * fail entirely over a taxonomy lookup hiccup.
 */
async function resolveCategoryId(productTypeLabel: string): Promise<string | null> {
  const searchTerm = CATEGORY_SEARCH_TERM[productTypeLabel];
  if (!searchTerm) return null;

  try {
    return await findJewelryCategoryId(searchTerm);
  } catch (error) {
    console.warn(
      `Couldn't resolve a Shopify taxonomy category for "${productTypeLabel}":`,
      error instanceof Error ? error.message : error
    );
    return null;
  }
}

// ── Product creation ─────────────────────────────────────────────────────

/**
 * One Color/Size variant, shaped for Shopify — a plain, already-resolved
 * mirror of src/lib/variants.ts's VariantRow (its `sameAsMainPrice`/
 * `grossWeightGrams`/`netWeightGrams` already resolved to a real number by
 * the caller via resolveVariantPrice, so this file never needs to know about
 * that concept).
 */
export interface ShopifyVariantInput {
  /** "" means this product doesn't use a Color option at all. */
  color: string;
  /** "" means this product doesn't use a Size option at all. */
  size: string;
  price: number;
  inventory: number;
  /** true = show the product's plain default photos, no dedicated gallery attached. false = this variant gets its own photo gallery, attached after the variant exists — see attachVariantGalleries. */
  useDefaultImages: boolean;
  /** 0 = not entered — written to Shopify as the `custom.variant_weight` variant metafield when positive (see buildVariantsInput), so the storefront can show each size's own weight instead of one product-wide number. Purely informational — never affects price unless the caller already folded it into `price` above via resolveVariantPrice. */
  grossWeightGrams: number;
}

export interface CreateShopifyProductInput {
  title: string;
  descriptionHtml: string;
  tags: string[];
  productType: string;
  price: number;
  inventory: number;
  /** Hero, lifestyle, closeup — in the order they should appear on the product page. */
  images: ShopifyImageInput[];
  /** Short SEO-style summary — also fills the "Short Description" product metafield, see buildMetafields. */
  metaDescription: string;
  /** Raw values for the store's existing custom product metafields — see buildMetafields. Nullish ones just don't get a metafield set. */
  weightGrams: number;
  stone: string;
  finish: string;
  widthCm: number | null;
  lengthCm: number | null;
  /** Real Shopify collection titles (from Review's AI classification, or hand-edited) — resolved to collection ids via listCollections/resolveCollectionIds below. Titles that don't match a real collection are silently dropped rather than erroring, same reasoning as resolveCategoryId's no-confident-match case. */
  collections?: string[];
  /** Empty array = today's single "Default Title" variant (see buildVariantsInput) — every product that doesn't use this feature is completely unaffected. */
  variants: ShopifyVariantInput[];
}

export interface PublishProductInput extends CreateShopifyProductInput {
  seoTitle: string;
}

// ── Product metafields ───────────────────────────────────────────────────
// The 6 custom metafield definitions already set up on this store (Settings
// > Custom data > Products): Short Description, Weight (display), Stone,
// Material, Width (cm), Length (cm). Namespace/key confirmed live against
// the store's own metafieldDefinitions rather than guessed — a wrong
// namespace/key either creates a stray duplicate definition or fails
// outright, the same class of mistake as the productOptions/optionValues
// errors earlier. `type` is omitted from every entry below since these all
// already have a definition — Shopify infers/validates the type from that
// instead of needing it repeated here.
//
// Only ever includes a metafield when there's an actual value for it —
// most product types leave one or more of stone/widthCm/lengthCm unused
// (e.g. a ring has no widthCm), and there's no reason to write an empty
// value for those.

/** "dimension" metafields store a JSON string, not a bare number — https://shopify.dev/docs/apps/build/metafields/list-of-data-types (confirmed live: lowercase unit name, e.g. "centimeters"). */
function dimensionMetafieldValue(cm: number): string {
  return JSON.stringify({ value: cm, unit: "centimeters" });
}

function buildMetafields(input: CreateShopifyProductInput): { namespace: string; key: string; value: string }[] {
  const metafields: { namespace: string; key: string; value: string }[] = [];

  if (input.metaDescription) {
    metafields.push({ namespace: "custom", key: "short_description", value: input.metaDescription });
  }
  if (input.weightGrams > 0) {
    metafields.push({ namespace: "custom", key: "weight_display", value: `${input.weightGrams}g` });
  }
  if (input.stone) {
    metafields.push({ namespace: "custom", key: "stone", value: input.stone });
  }
  if (input.finish) {
    // No distinct "material" field exists upstream (see ProductRecord) —
    // finish (e.g. "Polished Gold") is the closest available value, and
    // already names the base metal as part of the finish description.
    metafields.push({ namespace: "custom", key: "material", value: input.finish });
  }
  if (input.widthCm != null) {
    metafields.push({ namespace: "custom", key: "width_cm", value: dimensionMetafieldValue(input.widthCm) });
  }
  if (input.lengthCm != null) {
    metafields.push({ namespace: "custom", key: "length_cm", value: dimensionMetafieldValue(input.lengthCm) });
  }

  return metafields;
}

// ── Variants → productSet input ─────────────────────────────────────────

function uniqueTrimmedInOrder(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (trimmed && !seen.has(trimmed)) {
      seen.add(trimmed);
      result.push(trimmed);
    }
  }
  return result;
}

function variantKey(color: string, size: string): string {
  return `${color.trim().toLowerCase()}::${size.trim().toLowerCase()}`;
}

/**
 * Builds productSet's `productOptions`/`variants` input from either nothing
 * (today's single "Default Title" variant — see the history in this
 * function's own comment below) or a real list of Color/Size variants.
 * Shared by createShopifyProduct (initial publish) and
 * syncShopifyProductVariants (post-publish edits) so the two can never drift
 * apart on how a variant becomes Shopify input. Never touches photos —
 * a variant's gallery is attached in a separate step after this input's
 * variants actually exist and have real ids (see attachVariantGalleries),
 * since Shopify has no way to attach more than one photo to a variant in
 * the same call that creates/updates it.
 *
 * `existingVariantIdByKey`, when provided (only by the sync/update path),
 * lets a row that matches an already-existing Shopify variant (matched by
 * its Color/Size combination) update that variant in place via its `id`
 * instead of creating a duplicate.
 */
function buildVariantsInput(
  basePrice: number,
  baseInventory: number,
  variants: ShopifyVariantInput[],
  locationId: string,
  existingVariantIdByKey?: Map<string, string>
): {
  productOptions: { name: string; values: { name: string }[]; linkedMetafield: null }[];
  variants: Record<string, unknown>[];
} {
  if (variants.length === 0) {
    // Every product here used to be a single-variant listing (no real size/
    // color choices to make), which used to just get Shopify's implicit
    // default "Title"/"Default Title" option/value pair for free with no
    // input needed. Current API versions no longer infer that: `productSet`
    // now rejects the call unless `productOptions` is declared AND each
    // variant's `optionValues` explicitly references it — so this spells
    // out that same single default option/value pair by hand instead of
    // relying on it being automatic.
    return {
      productOptions: [{ name: "Title", values: [{ name: "Default Title" }], linkedMetafield: null }],
      variants: [
        {
          price: basePrice,
          inventoryQuantities: [{ locationId, name: "available", quantity: baseInventory }],
          optionValues: [{ optionName: "Title", name: "Default Title" }],
        },
      ],
    };
  }

  const usesColor = variants.some((v) => v.color.trim() !== "");
  const usesSize = variants.some((v) => v.size.trim() !== "");

  // `linkedMetafield: null` is required, not just harmless, on every
  // productOption below — confirmed live against this store. When a
  // product's Category is Rings (see resolveCategoryId) and an option here
  // is named "Size", Shopify silently auto-links it to its own standard
  // `shopify.ring-size` metafield/taxonomy *without this code ever
  // requesting it*, and even renames the option to "Ring size" (which the
  // storefront's own isRingSizeOption already tolerates as an alias — see
  // selen-sparkle-shop's lib/ringSize.ts). That taxonomy's own fixed value
  // list only goes up to plain "14" before jumping to letter/EU sizes, so
  // any Indian ring size above that (16, 18 — see RING_SIZE_OPTIONS) gets
  // rejected outright by productSet with "At least one value for the option
  // linked to the 'shopify.ring-size' metafield is invalid". Explicitly
  // nulling it here — on every call, not just once — is the only way to
  // keep the option a plain custom option that accepts our own Indian
  // sizing instead of Shopify's US/EU one; omitting the field isn't enough
  // once a product has already been auto-linked, since productSet then
  // leaves the existing link untouched.
  const productOptions: { name: string; values: { name: string }[]; linkedMetafield: null }[] = [];
  if (usesColor) {
    productOptions.push({
      name: "Color",
      values: uniqueTrimmedInOrder(variants.map((v) => v.color)).map((name) => ({ name })),
      linkedMetafield: null,
    });
  }
  if (usesSize) {
    productOptions.push({
      name: "Size",
      values: uniqueTrimmedInOrder(variants.map((v) => v.size)).map((name) => ({ name })),
      linkedMetafield: null,
    });
  }

  const shopifyVariants = variants.map((variant) => {
    const optionValues: { optionName: string; name: string }[] = [];
    if (usesColor) optionValues.push({ optionName: "Color", name: variant.color.trim() });
    if (usesSize) optionValues.push({ optionName: "Size", name: variant.size.trim() });

    const existingId = existingVariantIdByKey?.get(variantKey(variant.color, variant.size));

    return {
      ...(existingId ? { id: existingId } : {}),
      price: variant.price,
      inventoryQuantities: [{ locationId, name: "available", quantity: variant.inventory }],
      optionValues,
      // `custom.variant_weight` — a plain-text, per-variant metafield (its
      // definition already exists on the store, so `type` is omitted here,
      // same convention buildMetafields uses for the product-level fields)
      // that lets the storefront show each size's own weight instead of one
      // product-wide number. Omitted entirely when nothing was entered,
      // same "only write when there's an actual value" convention as
      // buildMetafields.
      ...(variant.grossWeightGrams > 0
        ? { metafields: [{ namespace: "custom", key: "variant_weight", value: `${variant.grossWeightGrams}g` }] }
        : {}),
    };
  });

  return { productOptions, variants: shopifyVariants };
}

// ── Variant photo galleries ──────────────────────────────────────────────
// A Shopify variant can hold many photos (ProductVariant.media is a full
// connection, confirmed live against this store's schema) — but nothing in
// productSet's variant input can attach more than one at variant-creation
// time. So a variant's gallery is staged as ordinary product media first
// (productCreateMedia, same mechanism replaceProductMedia already uses for
// the product's own base photos), then explicitly linked to its variant(s)
// via productVariantAppendMedia once the variant has a real id. Not yet
// execution-tested against the live store (only schema-validated) — same
// caveat replaceProductMedia's own NOTE above already carries for
// productCreateMedia/productDeleteMedia; test against one non-critical
// product before relying on this broadly.

const MEDIA_READY_POLL_INTERVAL_MS = 1_000;
const MEDIA_READY_TIMEOUT_MS = 25_000;

/**
 * Waits for freshly-created media to finish processing. `productCreateMedia`
 * returns an id immediately, but Shopify processes the actual image
 * asynchronously (UPLOADED -> PROCESSING -> READY/FAILED) — confirmed live:
 * attaching a variant to media that isn't READY yet fails outright with
 * "Non-ready media cannot be attached to variants." Polls every id via the
 * generic `nodes` query (an inline fragment on the `Media` interface, since
 * that's where `status` lives) until each is READY, FAILED, or the timeout
 * elapses. Returns only the ids that made it to READY in time — a caller
 * losing one photo to a slow/failed processing job should still attach
 * whatever else is ready rather than fail the whole save/publish over it.
 */
async function waitForMediaReady(mediaIds: string[]): Promise<Set<string>> {
  const pending = new Set(mediaIds);
  const ready = new Set<string>();
  const deadline = Date.now() + MEDIA_READY_TIMEOUT_MS;

  while (pending.size > 0 && Date.now() < deadline) {
    const data = await shopifyGraphQL<{ nodes: ({ id: string; status: string } | null)[] }>(
      `query getMediaStatuses($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on Media { id status }
        }
      }`,
      { ids: Array.from(pending) }
    );

    for (const node of data.nodes) {
      if (!node) continue;
      if (node.status === "READY") {
        ready.add(node.id);
        pending.delete(node.id);
      } else if (node.status === "FAILED") {
        pending.delete(node.id);
      }
    }

    if (pending.size > 0) {
      await new Promise((resolve) => setTimeout(resolve, MEDIA_READY_POLL_INTERVAL_MS));
    }
  }

  return ready;
}

/**
 * Stages and creates real Shopify media for a batch of variant-gallery
 * photos, returning `filename -> media id` for whichever finished
 * processing in time (see waitForMediaReady). `productCreateMedia`'s
 * response returns `media` in the same order as the input array — that's
 * how each result gets matched back to the image that produced it, since
 * `filename` is already unique per photo (see loadVariantColorShopifyImages
 * in shopify-listing.ts).
 */
async function stageGalleryMedia(productGid: string, images: ShopifyImageInput[]): Promise<Map<string, string>> {
  if (images.length === 0) return new Map();

  const resourceUrls = await Promise.all(images.map((image) => stageImageUpload(image)));
  const media = images.map((image, i) => ({
    originalSource: resourceUrls[i],
    alt: image.alt,
    mediaContentType: "IMAGE",
  }));

  const data = await shopifyGraphQL<{
    productCreateMedia: {
      media: { id: string }[];
      mediaUserErrors: { field?: string[] | null; message: string }[];
    };
  }>(
    `mutation createGalleryMedia($productId: ID!, $media: [CreateMediaInput!]!) {
      productCreateMedia(productId: $productId, media: $media) {
        media { id }
        mediaUserErrors { field message }
      }
    }`,
    { productId: productGid, media }
  );
  assertNoUserErrors(data.productCreateMedia.mediaUserErrors, "productCreateMedia (variant gallery)");

  const mediaIdByFilename = new Map<string, string>();
  data.productCreateMedia.media.forEach((created, i) => {
    mediaIdByFilename.set(images[i].filename, created.id);
  });

  const readyIds = await waitForMediaReady(Array.from(mediaIdByFilename.values()));
  for (const [filename, id] of mediaIdByFilename) {
    if (!readyIds.has(id)) mediaIdByFilename.delete(filename);
  }
  return mediaIdByFilename;
}

/** Groups staged gallery media ids by (normalized) Color — the shape attachVariantGalleries needs to know which media ids belong to which color's variant(s). */
function groupMediaIdsByColor(images: ShopifyImageInput[], mediaIdByFilename: Map<string, string>): Map<string, string[]> {
  const byColor = new Map<string, string[]>();
  for (const image of images) {
    if (!image.color) continue;
    const mediaId = mediaIdByFilename.get(image.filename);
    if (!mediaId) continue;
    const key = image.color.trim().toLowerCase();
    const list = byColor.get(key) ?? [];
    list.push(mediaId);
    byColor.set(key, list);
  }
  return byColor;
}

/** Every media id currently attached to one variant — used so attachVariantGalleries can detach the old set before attaching the new one, giving clean "replace" semantics instead of accumulating duplicates on repeated saves. */
async function getVariantMediaIds(variantGid: string): Promise<string[]> {
  const data = await shopifyGraphQL<{ productVariant: { media: { nodes: { id: string }[] } } | null }>(
    `query getVariantMedia($id: ID!) {
      productVariant(id: $id) {
        media(first: 50) { nodes { id } }
      }
    }`,
    { id: variantGid }
  );
  return data.productVariant?.media.nodes.map((n) => n.id) ?? [];
}

/**
 * Attaches exactly **one** representative photo per variant — never that
 * color's whole gallery. The Admin API's variant `media` connection can
 * hold many items, but the Storefront API's `variant.image` (what
 * selen-sparkle-shop actually reads as a fallback — see
 * writeColorGalleryMetafields below for the gallery it reads *first*) is a
 * legacy singular view of that association; keeping it to one media id per
 * variant is what keeps that view unambiguous. When a color has more than
 * one photo, each Size variant of that color gets a different one
 * (round-robin by position) rather than all showing the same shot — a
 * cosmetic nicety for Shopify's own admin variant list now that the curated
 * metafield gallery is the storefront's real source.
 *
 * Runs for *every* variant, including ones flagged `useDefaultImages` —
 * Shopify's own admin variant list shows a bare placeholder icon for a
 * variant with nothing attached at all (confirmed against the live store),
 * it does not fall back to showing the product's default photo the way the
 * storefront does. `mediaIdsByColor` already includes the default row's own
 * color (createShopifyProduct/syncShopifyProductVariants stage the base
 * photos under that color too, specifically so this has something to
 * attach), so this needs no special-casing — a color with genuinely nothing
 * staged for it (mediaIds empty/missing) is simply skipped either way.
 * Detaches whatever a variant already has attached first (a no-op for a
 * freshly-created variant), so a repeated save/regenerate replaces rather
 * than piles onto it.
 */
async function attachVariantGalleries(
  productGid: string,
  variants: ShopifyVariantInput[],
  mediaIdsByColor: Map<string, string[]>,
  variantIdByKey: Map<string, string>
): Promise<void> {
  const seenPerColor = new Map<string, number>();

  for (const variant of variants) {
    const colorKey = variant.color.trim().toLowerCase();
    const mediaIds = mediaIdsByColor.get(colorKey);
    if (!mediaIds || mediaIds.length === 0) continue;

    const variantGid = variantIdByKey.get(variantKey(variant.color, variant.size));
    if (!variantGid) continue;

    const index = seenPerColor.get(colorKey) ?? 0;
    seenPerColor.set(colorKey, index + 1);
    const mediaId = mediaIds[index % mediaIds.length];

    const currentMediaIds = await getVariantMediaIds(variantGid);
    if (currentMediaIds.length > 0) {
      const detachData = await shopifyGraphQL<{
        productVariantDetachMedia: { userErrors: { field?: string[] | null; message: string }[] };
      }>(
        `mutation detachVariantMedia($productId: ID!, $variantMedia: [ProductVariantDetachMediaInput!]!) {
          productVariantDetachMedia(productId: $productId, variantMedia: $variantMedia) {
            userErrors { field message }
          }
        }`,
        { productId: productGid, variantMedia: [{ variantId: variantGid, mediaIds: currentMediaIds }] }
      );
      assertNoUserErrors(detachData.productVariantDetachMedia.userErrors, "productVariantDetachMedia");
    }

    const attachData = await shopifyGraphQL<{
      productVariantAppendMedia: { userErrors: { field?: string[] | null; message: string }[] };
    }>(
      `mutation appendVariantMedia($productId: ID!, $variantMedia: [ProductVariantAppendMediaInput!]!) {
        productVariantAppendMedia(productId: $productId, variantMedia: $variantMedia) {
          userErrors { field message }
        }
      }`,
      { productId: productGid, variantMedia: [{ variantId: variantGid, mediaIds: [mediaId] }] }
    );
    assertNoUserErrors(attachData.productVariantAppendMedia.userErrors, "productVariantAppendMedia");
  }
}

/**
 * Writes each color's full photo list into selen-sparkle-shop's curated
 * gallery metafield — `custom.gallery_yellow_gold`/`gallery_rose_gold`/
 * `gallery_silver` (already created as `list.file_reference` definitions on
 * the store; see colorGalleryMetafieldKey's doc comment in lib/variants.ts).
 * This, not the per-variant photo attachVariantGalleries sets, is what the
 * storefront actually swaps to when a shopper picks a color — its own
 * `getColorGallery` tries this metafield first, before ever looking at a
 * variant's image. `type` is omitted, same convention buildMetafields uses
 * for this store's other pre-created metafield definitions. Not yet
 * execution-tested against this store's actual field (only the general
 * list-reference JSON-array-of-GIDs format is a documented Shopify
 * convention) — verify on one non-critical product first. A color outside
 * the 3 the storefront recognizes (colorGalleryMetafieldKey returns
 * undefined) is silently skipped, never errors.
 */
async function writeColorGalleryMetafields(productGid: string, mediaIdsByColor: Map<string, string[]>): Promise<void> {
  const metafields = Array.from(mediaIdsByColor.entries())
    .map(([color, mediaIds]) => ({ key: colorGalleryMetafieldKey(color), mediaIds }))
    .filter((entry): entry is { key: string; mediaIds: string[] } => Boolean(entry.key) && entry.mediaIds.length > 0)
    .map(({ key, mediaIds }) => ({
      ownerId: productGid,
      namespace: "custom",
      key,
      value: JSON.stringify(mediaIds),
    }));

  if (metafields.length === 0) return;

  const data = await shopifyGraphQL<{
    metafieldsSet: { userErrors: { field?: string[] | null; message: string }[] };
  }>(
    `mutation setColorGalleries($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        userErrors { field message }
      }
    }`,
    { metafields }
  );
  assertNoUserErrors(data.metafieldsSet.userErrors, "metafieldsSet (color gallery)");
}

/**
 * Creates a fully-formed product — title, description, tags, images,
 * variants (price/stock per Color/Size combination, or a single default
 * variant when none are configured) — in one call via `productSet`, run
 * synchronously so the new product's id comes back directly instead of
 * needing a follow-up poll. `productSet` (rather than the older
 * `productCreate` + `productVariantsBulkUpdate` + a separate inventory call)
 * is Shopify's current recommended single-request way to do this — every
 * field lands atomically instead of the product briefly existing
 * half-configured between several calls. Variant photo galleries (anything
 * with `useDefaultImages: false`) are attached in a follow-up step once the
 * variants have real ids — see attachVariantGalleries above.
 * https://shopify.dev/docs/api/admin-graphql/latest/mutations/productSet
 */
async function createShopifyProduct(input: CreateShopifyProductInput): Promise<string> {
  const baseImages = input.images.filter((image) => !image.color);
  // Whichever row (if any) is flagged `useDefaultImages` should get its own
  // gallery metafield too, populated from the same base photos every other
  // variant already falls back to — not just the non-default colors. Tagged
  // copies of the base images (not the base images themselves — `files`
  // below still handles those, atomically, as always) flow through the same
  // staging/metafield pipeline as any other color's gallery.
  const defaultImagesColor = input.variants.find((v) => v.useDefaultImages)?.color;
  const galleryImages = [
    ...input.images.filter((image) => image.color),
    ...(defaultImagesColor ? baseImages.map((image) => ({ ...image, color: defaultImagesColor })) : []),
  ];

  const [locationId, resourceUrls, categoryId, collectionIds] = await Promise.all([
    getPrimaryLocationId(),
    Promise.all(baseImages.map((image) => stageImageUpload(image))),
    resolveCategoryId(input.productType),
    resolveCollectionIds(input.collections ?? []),
  ]);

  const files = baseImages.map((image, i) => ({
    originalSource: resourceUrls[i],
    alt: image.alt,
    filename: image.filename,
    contentType: "IMAGE",
  }));

  const { productOptions, variants: variantsInput } = buildVariantsInput(
    input.price,
    input.inventory,
    input.variants,
    locationId
  );

  const data = await shopifyGraphQL<{
    productSet: {
      product: { id: string } | null;
      userErrors: { field?: string[] | null; message: string }[];
    };
  }>(
    `mutation createProduct($productSet: ProductSetInput!, $synchronous: Boolean!) {
      productSet(synchronous: $synchronous, input: $productSet) {
        product { id }
        userErrors { field message }
      }
    }`,
    {
      synchronous: true,
      productSet: {
        title: input.title,
        descriptionHtml: input.descriptionHtml,
        tags: input.tags,
        vendor: VENDOR,
        productType: input.productType,
        // Shopify's standard taxonomy category, resolved above — omitted
        // entirely (rather than sent as null) when resolveCategoryId
        // couldn't find a confident match, so the field is simply left for
        // someone to set by hand in that case instead of erroring.
        ...(categoryId ? { category: categoryId } : {}),
        // DRAFT rather than ACTIVE — a product this app publishes lands in
        // Shopify hidden from the storefront until someone reviews it there
        // and flips it live by hand. Safer default for a tool whose output
        // depends on AI-generated images/copy; revisit once you trust the
        // pipeline enough to skip that manual review step.
        status: "DRAFT",
        files,
        // Omitted entirely (rather than sent as []) when nothing matched —
        // an empty array is a valid "no collections" input too, but leaving
        // the key out entirely is consistent with how categoryId above only
        // appears when resolved.
        ...(collectionIds.length > 0 ? { collections: collectionIds } : {}),
        productOptions,
        metafields: buildMetafields(input),
        variants: variantsInput,
      },
    }
  );

  assertNoUserErrors(data.productSet.userErrors, "productSet");
  const productId = data.productSet.product?.id;
  if (!productId) {
    throw new Error("Shopify did not return a product id after creation.");
  }

  if (galleryImages.length > 0) {
    const [mediaIdByFilename, variantIdByKey] = await Promise.all([
      stageGalleryMedia(productId, galleryImages),
      getExistingVariantIdsByKey(productId),
    ]);
    const mediaIdsByColor = groupMediaIdsByColor(galleryImages, mediaIdByFilename);
    await Promise.all([
      attachVariantGalleries(productId, input.variants, mediaIdsByColor, variantIdByKey),
      writeColorGalleryMetafields(productId, mediaIdsByColor),
    ]);
  }

  return productId;
}

/**
 * Sets the product's SEO title/meta description — `productSet` doesn't
 * accept an `seo` field, so this is a required follow-up call, not an
 * optional extra. Deliberately a separate exported function (rather than
 * folded into createShopifyProduct) so publishProductToShopify below can
 * treat its failure as non-fatal: the product already exists in Shopify by
 * this point, so a failure here shouldn't be reported as the whole publish
 * having failed, just logged.
 */
async function setProductSeo(productId: string, seoTitle: string, metaDescription: string): Promise<void> {
  const data = await shopifyGraphQL<{
    productUpdate: {
      product: { id: string } | null;
      userErrors: { field?: string[] | null; message: string }[];
    };
  }>(
    `mutation setSeo($input: ProductInput!) {
      productUpdate(input: $input) {
        product { id }
        userErrors { field message }
      }
    }`,
    { input: { id: productId, seo: { title: seoTitle, description: metaDescription } } }
  );
  assertNoUserErrors(data.productUpdate.userErrors, "productUpdate (SEO)");
}

function numericIdFromGid(gid: string): string {
  return gid.split("/").pop() ?? gid;
}

export interface PublishResult {
  shopifyProductId: string;
  adminUrl: string;
}

/**
 * Full publish: create the product (title/description/tags/images/price/
 * inventory), then best-effort set its SEO metadata and publish it to every
 * sales channel. Called once by /api/products/[productId]/publish/route.ts.
 * Neither follow-up failing fails the whole publish — see setProductSeo's
 * and publishToAllChannels's doc comments — but each does get logged so a
 * silent gap (missing SEO title, or a product stuck on zero channels) is
 * discoverable, not just lost.
 */
export async function publishProductToShopify(input: PublishProductInput): Promise<PublishResult> {
  const productGid = await createShopifyProduct(input);
  const numericId = numericIdFromGid(productGid);

  try {
    await setProductSeo(productGid, input.seoTitle, input.metaDescription);
  } catch (error) {
    console.warn(
      `Shopify product ${numericId} was created, but setting its SEO metadata failed:`,
      error instanceof Error ? error.message : error
    );
  }

  try {
    await publishToAllChannels(productGid);
  } catch (error) {
    console.warn(
      `Shopify product ${numericId} was created, but publishing it to sales channels failed:`,
      error instanceof Error ? error.message : error
    );
  }

  return {
    shopifyProductId: numericId,
    adminUrl: `https://${storeDomain()}/admin/products/${numericId}`,
  };
}

// ── Pricing Dashboard sync ───────────────────────────────────────────────
// The Admin Pricing Dashboard's one integration point with Shopify (see
// src/lib/pricing.ts and services/pricing.ts): pushes only the final
// computed price and, optionally, Gross Weight — never Net Weight, making
// charge, stone/pearl line items, or Rate/gram, which stay entirely
// internal to this dashboard.

function productGidFromNumericId(numericId: string): string {
  return `gid://shopify/Product/${numericId}`;
}

/**
 * Looks up an already-published product's single variant id — every
 * product this app creates has exactly one ("Default Title") variant, but
 * `productVariantsBulkUpdate` needs that variant's own id, not the
 * product's, and productSet's create-time response never returned it (only
 * `product { id }`), so it's fetched fresh here rather than stored anywhere.
 */
async function getDefaultVariantId(productGid: string): Promise<string> {
  const data = await shopifyGraphQL<{
    product: { variants: { nodes: { id: string }[] } } | null;
  }>(
    `query getVariant($id: ID!) {
      product(id: $id) {
        variants(first: 1) { nodes { id } }
      }
    }`,
    { id: productGid }
  );
  const variantId = data.product?.variants.nodes[0]?.id;
  if (!variantId) {
    throw new Error(`Shopify product ${productGid} has no variant to update.`);
  }
  return variantId;
}

export interface UpdateShopifyPriceInput {
  shopifyProductId: string;
  /** The final, already-computed (and already-rounded) price — see computeFinalPrice in src/lib/pricing.ts. Never a raw/unrounded value. */
  price: number;
  /** Only pushed when provided — omitted for a plain "Update All Prices" rate refresh, since gross weight doesn't change there. */
  grossWeightGrams?: number;
}

/**
 * Pushes a recomputed price (and, optionally, an updated Gross Weight) to
 * an already-published product — the one place this dashboard talks back
 * to Shopify after the initial publish. Used by both the per-product
 * pricing save and the bulk "Update All Prices" action (services/pricing.ts).
 * Throws on failure rather than swallowing it — callers are expected to
 * catch this and mark the product `priceSyncStatus: "out_of_sync"` rather
 * than have the sync itself decide that's fine.
 */
export async function updateShopifyProductPrice(input: UpdateShopifyPriceInput): Promise<void> {
  const productGid = productGidFromNumericId(input.shopifyProductId);
  const variantId = await getDefaultVariantId(productGid);

  const variantData = await shopifyGraphQL<{
    productVariantsBulkUpdate: {
      userErrors: { field?: string[] | null; message: string }[];
    };
  }>(
    `mutation updatePrice($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
      productVariantsBulkUpdate(productId: $productId, variants: $variants) {
        userErrors { field message }
      }
    }`,
    { productId: productGid, variants: [{ id: variantId, price: input.price }] }
  );
  assertNoUserErrors(variantData.productVariantsBulkUpdate.userErrors, "productVariantsBulkUpdate (price sync)");

  if (input.grossWeightGrams != null && input.grossWeightGrams > 0) {
    const metafieldData = await shopifyGraphQL<{
      metafieldsSet: { userErrors: { field?: string[] | null; message: string }[] };
    }>(
      `mutation updateWeight($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          userErrors { field message }
        }
      }`,
      {
        metafields: [
          {
            ownerId: productGid,
            namespace: "custom",
            key: "weight_display",
            value: `${input.grossWeightGrams}g`,
          },
        ],
      }
    );
    assertNoUserErrors(metafieldData.metafieldsSet.userErrors, "metafieldsSet (weight sync)");
  }
}

/**
 * Looks up an already-published, variant-less product's single variant's
 * inventory item id — `inventorySetQuantities` below addresses stock by
 * inventoryItemId + locationId, not by variant id, so this is fetched fresh
 * rather than stored anywhere (same reasoning as getDefaultVariantId above).
 */
async function getDefaultVariantInventoryItemId(productGid: string): Promise<string> {
  const data = await shopifyGraphQL<{
    product: { variants: { nodes: { inventoryItem: { id: string } }[] } } | null;
  }>(
    `query getVariantInventoryItem($id: ID!) {
      product(id: $id) {
        variants(first: 1) { nodes { inventoryItem { id } } }
      }
    }`,
    { id: productGid }
  );
  const inventoryItemId = data.product?.variants.nodes[0]?.inventoryItem.id;
  if (!inventoryItemId) {
    throw new Error(`Shopify product ${productGid} has no variant to update.`);
  }
  return inventoryItemId;
}

export interface UpdateShopifyInventoryInput {
  shopifyProductId: string;
  /** The absolute stock count to set — not a delta. */
  inventory: number;
}

/**
 * Pushes an absolute stock count to an already-published, variant-less
 * product's single default variant — the plain Inventory field's
 * post-publish counterpart to updateShopifyProductPrice above (see
 * services/inventory.ts, which mirrors services/pricing.ts's "sync
 * immediately on save" decision for it). Uses `inventorySetQuantities`
 * (Shopify's absolute "set to exactly this many" mutation) rather than the
 * `inventoryQuantities` input buildVariantsInput sends — that field only
 * takes effect when a variant is first created, not on an update. A product
 * using real Color/Size variants never calls this; its per-variant stock
 * goes through syncShopifyProductVariants instead. `changeFromQuantity: null`
 * skips Shopify's compare-and-swap check (successor to the removed
 * `ignoreCompareQuantity` field) since we always want to overwrite with the
 * absolute count regardless of what's currently on Shopify. The
 * `@idempotent` key (required since 2026-04) is fresh per call — each save
 * is a distinct intended write, and nothing here retries. Throws on
 * failure — same catch-and-flag-out_of_sync contract as
 * updateShopifyProductPrice.
 */
export async function updateShopifyProductInventory(input: UpdateShopifyInventoryInput): Promise<void> {
  const productGid = productGidFromNumericId(input.shopifyProductId);
  const [inventoryItemId, locationId] = await Promise.all([
    getDefaultVariantInventoryItemId(productGid),
    getPrimaryLocationId(),
  ]);

  const data = await shopifyGraphQL<{
    inventorySetQuantities: { userErrors: { field?: string[] | null; message: string }[] };
  }>(
    `mutation setInventory($input: InventorySetQuantitiesInput!, $idempotencyKey: String!) {
      inventorySetQuantities(input: $input) @idempotent(key: $idempotencyKey) {
        userErrors { field message }
      }
    }`,
    {
      input: {
        name: "available",
        reason: "correction",
        quantities: [
          { inventoryItemId, locationId, quantity: input.inventory, changeFromQuantity: null },
        ],
      },
      idempotencyKey: randomUUID(),
    }
  );
  assertNoUserErrors(data.inventorySetQuantities.userErrors, "inventorySetQuantities");
}

// ── Post-publish listing sync ───────────────────────────────────────────
// Finalize's "Update Shopify Listing" action (api/products/[productId]/sync/
// route.ts) — re-pushes title/description/tags/SEO/photos to a product
// that's already live on Shopify, for edits made on Review after the
// initial Publish. Unlike publishProductToShopify's create-time productSet
// call, these mutations target an *existing* product id.
//
// NOTE: unlike the rest of this file, productCreateMedia/productDeleteMedia
// below haven't been confirmed live against this store yet (see the
// "confirmed live" comments on buildMetafields above for why that
// matters — a wrong field/type here fails the same way those did). Test
// against one non-critical product before relying on this broadly.

/**
 * Replaces every existing media item on a product with `images` — deletes
 * whatever's currently attached, then stages and attaches the new set.
 * Delete-then-recreate rather than trying to diff/reorder in place, since
 * this app always sends the full hero/lifestyle/closeup set together and
 * there's no per-image identity to match old media against new.
 */
async function replaceProductMedia(productGid: string, images: ShopifyImageInput[]): Promise<void> {
  const existing = await shopifyGraphQL<{ product: { media: { nodes: { id: string }[] } } | null }>(
    `query getProductMedia($id: ID!) {
      product(id: $id) { media(first: 50) { nodes { id } } }
    }`,
    { id: productGid }
  );
  const existingMediaIds = existing.product?.media.nodes.map((n) => n.id) ?? [];

  if (existingMediaIds.length > 0) {
    const deleteData = await shopifyGraphQL<{
      productDeleteMedia: { mediaUserErrors: { field?: string[] | null; message: string }[] };
    }>(
      `mutation deleteMedia($productId: ID!, $mediaIds: [ID!]!) {
        productDeleteMedia(productId: $productId, mediaIds: $mediaIds) {
          mediaUserErrors { field message }
        }
      }`,
      { productId: productGid, mediaIds: existingMediaIds }
    );
    assertNoUserErrors(deleteData.productDeleteMedia.mediaUserErrors, "productDeleteMedia");
  }

  const resourceUrls = await Promise.all(images.map((image) => stageImageUpload(image)));
  const media = images.map((image, i) => ({
    originalSource: resourceUrls[i],
    alt: image.alt,
    mediaContentType: "IMAGE",
  }));

  const createData = await shopifyGraphQL<{
    productCreateMedia: { mediaUserErrors: { field?: string[] | null; message: string }[] };
  }>(
    `mutation createMedia($productId: ID!, $media: [CreateMediaInput!]!) {
      productCreateMedia(productId: $productId, media: $media) {
        mediaUserErrors { field message }
      }
    }`,
    { productId: productGid, media }
  );
  assertNoUserErrors(createData.productCreateMedia.mediaUserErrors, "productCreateMedia");
}

export interface UpdateShopifyListingInput {
  shopifyProductId: string;
  title: string;
  descriptionHtml: string;
  tags: string[];
  seoTitle: string;
  metaDescription: string;
  images: ShopifyImageInput[];
}

/**
 * Pushes title/description/tags/SEO in one productUpdate call, then
 * replaces the product's media entirely. Throws on either step failing —
 * the caller (the sync route) is expected to catch this and flag
 * `listingSyncStatus: "out_of_sync"` rather than have this decide that's
 * fine, same contract as updateShopifyProductPrice above.
 */
export async function updateShopifyProductListing(input: UpdateShopifyListingInput): Promise<void> {
  const productGid = productGidFromNumericId(input.shopifyProductId);

  const data = await shopifyGraphQL<{
    productUpdate: {
      userErrors: { field?: string[] | null; message: string }[];
    };
  }>(
    `mutation updateListing($input: ProductInput!) {
      productUpdate(input: $input) {
        userErrors { field message }
      }
    }`,
    {
      input: {
        id: productGid,
        title: input.title,
        descriptionHtml: input.descriptionHtml,
        tags: input.tags,
        seo: { title: input.seoTitle, description: input.metaDescription },
      },
    }
  );
  assertNoUserErrors(data.productUpdate.userErrors, "productUpdate (listing sync)");

  await replaceProductMedia(productGid, input.images);
}

// ── Post-publish variants sync ──────────────────────────────────────────
// The Variants panel's "Save Variants" action (api/products/[productId]/
// variants/route.ts), for a product that's already been published — updates
// existing variants in place and creates new ones via the same productSet
// mutation used at initial publish (confirmed live against this store's
// schema: productSet accepts an `identifier: { id }` argument to target an
// existing product instead of creating a new one). Unlike
// updateShopifyProductListing's replaceProductMedia (delete-then-recreate),
// this never removes an existing Shopify variant that no longer has a
// matching row here — a merchant who wants a variant gone can archive/delete
// it by hand in Shopify; automatically deleting variants (and any order
// history tied to them) is a much higher-risk operation than this feature
// needs to take on.

export interface SyncShopifyVariantsInput {
  shopifyProductId: string;
  price: number;
  inventory: number;
  variants: ShopifyVariantInput[];
  images: ShopifyImageInput[];
}

/**
 * Every existing variant's id + selected options, used to match a saved
 * variant row back to the Shopify variant it should update (by Color/Size)
 * rather than create a duplicate.
 */
async function getExistingVariantIdsByKey(productGid: string): Promise<Map<string, string>> {
  const data = await shopifyGraphQL<{
    product: { variants: { nodes: { id: string; selectedOptions: { name: string; value: string }[] }[] } } | null;
  }>(
    `query getVariantsForSync($id: ID!) {
      product(id: $id) {
        variants(first: 50) {
          nodes { id selectedOptions { name value } }
        }
      }
    }`,
    { id: productGid }
  );

  const map = new Map<string, string>();
  for (const variant of data.product?.variants.nodes ?? []) {
    const color = variant.selectedOptions.find((o) => o.name === "Color")?.value ?? "";
    const size = variant.selectedOptions.find((o) => o.name === "Size")?.value ?? "";
    map.set(variantKey(color, size), variant.id);
  }
  return map;
}

/**
 * Pushes a saved variants list to an already-published product — matches
 * each row to its existing Shopify variant (by Color/Size) and updates it in
 * place, or creates a new one if no match exists. Throws on failure; the
 * caller (the variants save route) is expected to catch this and flag
 * `variantsSyncStatus: "out_of_sync"` rather than have this decide that's
 * fine, same contract as updateShopifyProductPrice/updateShopifyProductListing.
 *
 * Deliberately refuses an empty `variants` list rather than silently
 * collapsing an already-multi-variant product back down to a single
 * "Default Title" variant — the caller should simply not call this when
 * there's nothing to sync.
 *
 * Note: the base product photos get re-staged and re-uploaded fresh on
 * every save (same trade-off as replaceProductMedia above) — harmless, but
 * does leave the previous copy sitting in the store's Files section rather
 * than being cleaned up automatically. Variant galleries don't have this
 * problem — attachVariantGalleries detaches the old set before attaching
 * the new one.
 */
export async function syncShopifyProductVariants(input: SyncShopifyVariantsInput): Promise<void> {
  if (input.variants.length === 0) {
    throw new Error(
      "syncShopifyProductVariants requires at least one variant — clearing all variants on an already-published product isn't supported here; use Shopify admin directly."
    );
  }

  const productGid = productGidFromNumericId(input.shopifyProductId);
  const baseImages = input.images.filter((image) => !image.color);
  // Same reasoning as createShopifyProduct above — whichever row is flagged
  // `useDefaultImages` gets its own gallery metafield too, from tagged
  // copies of the base images.
  const defaultImagesColor = input.variants.find((v) => v.useDefaultImages)?.color;
  const galleryImages = [
    ...input.images.filter((image) => image.color),
    ...(defaultImagesColor ? baseImages.map((image) => ({ ...image, color: defaultImagesColor })) : []),
  ];

  const [locationId, existingVariantIdByKey, resourceUrls] = await Promise.all([
    getPrimaryLocationId(),
    getExistingVariantIdsByKey(productGid),
    Promise.all(baseImages.map((image) => stageImageUpload(image))),
  ]);

  const files = baseImages.map((image, i) => ({
    originalSource: resourceUrls[i],
    alt: image.alt,
    filename: image.filename,
    contentType: "IMAGE",
  }));

  const { productOptions, variants: variantsInput } = buildVariantsInput(
    input.price,
    input.inventory,
    input.variants,
    locationId,
    existingVariantIdByKey
  );

  const data = await shopifyGraphQL<{
    productSet: {
      product: { id: string } | null;
      userErrors: { field?: string[] | null; message: string }[];
    };
  }>(
    `mutation syncVariants($identifier: ProductSetIdentifiers!, $productSet: ProductSetInput!, $synchronous: Boolean!) {
      productSet(identifier: $identifier, synchronous: $synchronous, input: $productSet) {
        product { id }
        userErrors { field message }
      }
    }`,
    {
      identifier: { id: productGid },
      synchronous: true,
      productSet: {
        files,
        productOptions,
        variants: variantsInput,
      },
    }
  );

  assertNoUserErrors(data.productSet.userErrors, "productSet (variants sync)");

  if (galleryImages.length > 0) {
    // Re-fetched *after* the update above, not the pre-update snapshot in
    // `existingVariantIdByKey` — a brand-new row saved this round wouldn't
    // exist yet in that earlier snapshot.
    const [mediaIdByFilename, variantIdByKey] = await Promise.all([
      stageGalleryMedia(productGid, galleryImages),
      getExistingVariantIdsByKey(productGid),
    ]);
    const mediaIdsByColor = groupMediaIdsByColor(galleryImages, mediaIdByFilename);
    await Promise.all([
      attachVariantGalleries(productGid, input.variants, mediaIdsByColor, variantIdByKey),
      writeColorGalleryMetafields(productGid, mediaIdsByColor),
    ]);
  }
}

// ── Import from Shopify ─────────────────────────────────────────────────
// The reverse direction of everything else in this file: reads products
// that already exist on Shopify (typically created by hand in admin, never
// through this app) so api/products/import-candidates/route.ts can offer
// them for import into the Sheet. Read-only — nothing here writes to
// Shopify.

export interface ShopifyImportCandidate {
  /** Numeric id, same convention as ProductRecord.shopifyProductId elsewhere in this file. */
  shopifyProductId: string;
  title: string;
  descriptionHtml: string;
  tags: string[];
  productType: string;
  createdAt: string;
  seoTitle: string;
  metaDescription: string;
  /** First 3 media previews, in Shopify's own order — mapped to hero/lifestyle/closeup by the caller. */
  imageUrls: string[];
  /** Lowest variant price, as a plain number — a manually-created product can have several variants (size/color), which this app's single-price model can't represent individually. */
  price: number;
  /** Summed across every variant, same multi-variant caveat as price above. */
  inventory: number;
  collections: string[];
  /** Best-effort reads of this app's own custom metafield namespace (see buildMetafields above) — set only if a product happens to already have them (e.g. previously touched by this app, then edited by hand). null when absent, never a guess. */
  weightGrams: number | null;
  stone: string | null;
  finish: string | null;
  widthCm: number | null;
  lengthCm: number | null;
}

/**
 * Every non-archived Shopify product (up to `first`), newest first — an
 * Archived product is treated as retired/no-longer-for-sale, not something
 * worth ever offering for import. Filtered server-side via `query:
 * "-status:archived"` (Shopify's product search syntax) rather than
 * fetched-then-discarded, so `first` counts toward actually-importable
 * products instead of being partly eaten by archived ones. The caller is
 * still responsible for filtering out ones already tracked in the Sheet (by
 * shopifyProductId) before showing them as import candidates.
 * `inventoryQuantity` is a simple aggregate field on ProductVariant; Shopify's
 * docs steer newer code toward inventoryItem.inventoryLevels instead, but for
 * a best-effort import read (not a source of truth this app writes back to)
 * the simpler field is enough.
 */
export async function listShopifyProductsForImport(first = 100): Promise<ShopifyImportCandidate[]> {
  const data = await shopifyGraphQL<{
    products: {
      nodes: {
        id: string;
        title: string;
        descriptionHtml: string;
        tags: string[];
        productType: string;
        createdAt: string;
        seo: { title: string | null; description: string | null };
        media: { nodes: { preview: { image: { url: string } | null } | null }[] };
        variants: { nodes: { price: string; inventoryQuantity: number | null }[] };
        collections: { nodes: { title: string }[] };
        weightMetafield: { value: string } | null;
        stoneMetafield: { value: string } | null;
        materialMetafield: { value: string } | null;
        widthMetafield: { value: string } | null;
        lengthMetafield: { value: string } | null;
      }[];
    };
  }>(
    `query listProductsForImport($first: Int!, $query: String!) {
      products(first: $first, sortKey: CREATED_AT, reverse: true, query: $query) {
        nodes {
          id
          title
          descriptionHtml
          tags
          productType
          createdAt
          seo { title description }
          media(first: 3) { nodes { preview { image { url } } } }
          variants(first: 25) { nodes { price inventoryQuantity } }
          collections(first: 10) { nodes { title } }
          weightMetafield: metafield(namespace: "custom", key: "weight_display") { value }
          stoneMetafield: metafield(namespace: "custom", key: "stone") { value }
          materialMetafield: metafield(namespace: "custom", key: "material") { value }
          widthMetafield: metafield(namespace: "custom", key: "width_cm") { value }
          lengthMetafield: metafield(namespace: "custom", key: "length_cm") { value }
        }
      }
    }`,
    { first, query: "-status:archived" }
  );

  // "12g" -> 12 — the same plain-text format buildMetafields writes, not a
  // JSON dimension value like width/length below.
  const parseWeightMetafield = (raw: string | null | undefined): number | null => {
    if (!raw) return null;
    const parsed = Number.parseFloat(raw);
    return Number.isNaN(parsed) ? null : parsed;
  };
  // Dimension metafields store `{"value":N,"unit":"centimeters"}` — see
  // dimensionMetafieldValue above.
  const parseDimensionMetafield = (raw: string | null | undefined): number | null => {
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as { value?: number };
      return typeof parsed.value === "number" ? parsed.value : null;
    } catch {
      return null;
    }
  };

  return data.products.nodes.map((node) => {
    const prices = node.variants.nodes.map((v) => Number(v.price)).filter((p) => !Number.isNaN(p));
    const inventory = node.variants.nodes.reduce((sum, v) => sum + (v.inventoryQuantity ?? 0), 0);

    return {
      shopifyProductId: numericIdFromGid(node.id),
      title: node.title,
      descriptionHtml: node.descriptionHtml,
      tags: node.tags,
      productType: node.productType,
      createdAt: node.createdAt,
      seoTitle: node.seo.title ?? "",
      metaDescription: node.seo.description ?? "",
      imageUrls: node.media.nodes.map((m) => m.preview?.image?.url).filter((url): url is string => Boolean(url)),
      price: prices.length > 0 ? Math.min(...prices) : 0,
      inventory,
      collections: node.collections.nodes.map((c) => c.title),
      weightGrams: parseWeightMetafield(node.weightMetafield?.value),
      stone: node.stoneMetafield?.value ?? null,
      finish: node.materialMetafield?.value ?? null,
      widthCm: parseDimensionMetafield(node.widthMetafield?.value),
      lengthCm: parseDimensionMetafield(node.lengthMetafield?.value),
    };
  });
}

// ── Reconciliation ───────────────────────────────────────────────────────
// Read-only, like the import read above, but complete: every product
// (paged, not capped at `first`), every status, and each variant's SKU and
// stock — services/reconciliation.ts needs all of it to cross-check the
// Sheet's two tabs against Shopify.

export interface ShopifyReconciliationVariant {
  title: string;
  /** "" when the variant has no SKU set in Shopify admin. */
  sku: string;
  inventoryQuantity: number;
}

export interface ShopifyReconciliationProduct {
  shopifyProductId: string;
  title: string;
  status: ShopifyProductStatus;
  variants: ShopifyReconciliationVariant[];
}

export async function listShopifyProductsForReconciliation(): Promise<ShopifyReconciliationProduct[]> {
  const products: ShopifyReconciliationProduct[] = [];
  let after: string | null = null;

  do {
    const data: {
      products: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        nodes: {
          id: string;
          title: string;
          status: ShopifyProductStatus;
          variants: { nodes: { title: string; sku: string | null; inventoryQuantity: number | null }[] };
        }[];
      };
    } = await shopifyGraphQL(
      `query listProductsForReconciliation($after: String) {
        products(first: 100, after: $after, sortKey: TITLE) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id
            title
            status
            variants(first: 100) { nodes { title sku inventoryQuantity } }
          }
        }
      }`,
      { after }
    );

    for (const node of data.products.nodes) {
      products.push({
        shopifyProductId: numericIdFromGid(node.id),
        title: node.title,
        status: node.status,
        variants: node.variants.nodes.map((v) => ({
          title: v.title,
          sku: v.sku ?? "",
          inventoryQuantity: v.inventoryQuantity ?? 0,
        })),
      });
    }
    after = data.products.pageInfo.hasNextPage ? data.products.pageInfo.endCursor : null;
  } while (after);

  return products;
}

/** Link to a product's page in Shopify admin. */
export function shopifyAdminProductUrl(shopifyProductId: string): string {
  const storeHandle = storeDomain().replace(/\.myshopify\.com$/, "");
  return `https://admin.shopify.com/store/${storeHandle}/products/${shopifyProductId}`;
}

// ── Delete gating ────────────────────────────────────────────────────────

export type ShopifyProductStatus = "ACTIVE" | "ARCHIVED" | "DRAFT";

/**
 * Live status of a product on Shopify, or null if Shopify has no record of
 * it at all (removed from admin entirely, not just archived/drafted). Used
 * by the product DELETE route (src/app/api/products/[productId]/route.ts)
 * to decide whether it's safe to delete the local record: this app has no
 * way to remove a product from Shopify itself, so it only allows deleting
 * its own copy once Shopify confirms the listing is no longer Active there.
 */
export async function getShopifyProductStatus(shopifyProductId: string): Promise<ShopifyProductStatus | null> {
  const productGid = productGidFromNumericId(shopifyProductId);
  const data = await shopifyGraphQL<{ product: { status: ShopifyProductStatus } | null }>(
    `query getProductStatus($id: ID!) {
      product(id: $id) { status }
    }`,
    { id: productGid }
  );
  return data.product?.status ?? null;
}
