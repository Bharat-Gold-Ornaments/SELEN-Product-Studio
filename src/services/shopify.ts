import "server-only";
import { requireEnv, optionalEnv } from "@/lib/env";

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

// ── Image upload ─────────────────────────────────────────────────────────

export interface ShopifyImageInput {
  buffer: Buffer;
  mimeType: string;
  filename: string;
  alt: string;
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

/**
 * Creates a fully-formed product — title, description, tags, images, price,
 * and starting inventory — in one call via `productSet`, run synchronously
 * so the new product's id comes back directly instead of needing a
 * follow-up poll. `productSet` (rather than the older `productCreate` +
 * `productVariantsBulkUpdate` + a separate inventory call) is Shopify's
 * current recommended single-request way to do this — every field lands
 * atomically instead of the product briefly existing half-configured
 * between several calls. Every product here is a single-variant listing (no
 * real size/color choices to make), which used to just get Shopify's
 * implicit default "Title"/"Default Title" option/value pair for free with
 * no input needed. Current API versions no longer infer that: `productSet`
 * now rejects the call unless `productOptions` is declared AND each variant's
 * `optionValues` explicitly references it — so this spells out that same
 * single default option/value pair by hand instead of relying on it being
 * automatic.
 * https://shopify.dev/docs/api/admin-graphql/latest/mutations/productSet
 */
async function createShopifyProduct(input: CreateShopifyProductInput): Promise<string> {
  const [locationId, resourceUrls, categoryId, collectionIds] = await Promise.all([
    getPrimaryLocationId(),
    Promise.all(input.images.map((image) => stageImageUpload(image))),
    resolveCategoryId(input.productType),
    resolveCollectionIds(input.collections ?? []),
  ]);

  const files = input.images.map((image, i) => ({
    originalSource: resourceUrls[i],
    alt: image.alt,
    filename: image.filename,
    contentType: "IMAGE",
  }));

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
        // The single default option every variantless-options product gets —
        // see this function's doc comment for why this has to be spelled out
        // explicitly now instead of just omitted.
        productOptions: [{ name: "Title", values: [{ name: "Default Title" }] }],
        metafields: buildMetafields(input),
        variants: [
          {
            price: input.price,
            inventoryQuantities: [{ locationId, name: "available", quantity: input.inventory }],
            optionValues: [{ optionName: "Title", name: "Default Title" }],
          },
        ],
      },
    }
  );

  assertNoUserErrors(data.productSet.userErrors, "productSet");
  const productId = data.productSet.product?.id;
  if (!productId) {
    throw new Error("Shopify did not return a product id after creation.");
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
