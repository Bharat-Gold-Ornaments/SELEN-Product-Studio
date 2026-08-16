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
}

export interface PublishProductInput extends CreateShopifyProductInput {
  seoTitle: string;
  metaDescription: string;
}

/**
 * Creates a fully-formed product — title, description, tags, images, price,
 * and starting inventory — in one call via `productSet`, run synchronously
 * so the new product's id comes back directly instead of needing a
 * follow-up poll. `productSet` (rather than the older `productCreate` +
 * `productVariantsBulkUpdate` + a separate inventory call) is Shopify's
 * current recommended single-request way to do this — every field lands
 * atomically instead of the product briefly existing half-configured
 * between several calls. No `productOptions` are declared here since these
 * are always single-variant listings (no size/color choices to make), which
 * gets each product Shopify's automatic default "Title" variant.
 * https://shopify.dev/docs/api/admin-graphql/latest/mutations/productSet
 */
async function createShopifyProduct(input: CreateShopifyProductInput): Promise<string> {
  const [locationId, resourceUrls] = await Promise.all([
    getPrimaryLocationId(),
    Promise.all(input.images.map((image) => stageImageUpload(image))),
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
        // DRAFT rather than ACTIVE — a product this app publishes lands in
        // Shopify hidden from the storefront until someone reviews it there
        // and flips it live by hand. Safer default for a tool whose output
        // depends on AI-generated images/copy; revisit once you trust the
        // pipeline enough to skip that manual review step.
        status: "DRAFT",
        files,
        variants: [
          {
            price: input.price,
            inventoryQuantities: [{ locationId, name: "available", quantity: input.inventory }],
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
 * inventory) then best-effort set its SEO metadata. Called once by
 * /api/products/[productId]/publish/route.ts. SEO failing doesn't fail the
 * whole publish — see setProductSeo's doc comment — but does get logged so
 * a silently-missing SEO title is discoverable, not just lost.
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

  return {
    shopifyProductId: numericId,
    adminUrl: `https://${storeDomain()}/admin/products/${numericId}`,
  };
}
