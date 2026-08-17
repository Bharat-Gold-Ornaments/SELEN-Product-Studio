import "server-only";
import { google, type drive_v3 } from "googleapis";
import { Readable } from "stream";
import { requireEnv } from "@/lib/env";
import type { ProductType } from "@/types/product";

// ── Client setup ─────────────────────────────────────────────────────────

let cachedClient: drive_v3.Drive | null = null;

/**
 * Lazily creates (and caches) an authenticated Drive client, acting AS the
 * real Google account behind GOOGLE_OAUTH_REFRESH_TOKEN — not as the
 * service account. This is deliberate: a service account has no storage
 * quota of its own, so any file/folder it creates in a personal ("My
 * Drive") folder fails with "Service Accounts do not have storage quota."
 * Google's own fix for that is Shared Drives, but those require a paid
 * Google Workspace account. Acting as a real personal Gmail account via
 * OAuth sidesteps that entirely — created files are owned by that account
 * and use its normal (free) 15GB quota, same as uploading through the
 * Drive web UI by hand. Google Sheets, by contrast, still uses the service
 * account (services/google-sheets.ts) since editing an existing
 * spreadsheet doesn't create new Drive-owned files and never hits this
 * quota wall. See .env.example for the one-time setup steps to get a
 * refresh token.
 *
 * Note on scope: the refresh token must have been issued for the narrow
 * "drive.file" scope (access limited to files this app itself creates),
 * not the full "drive" scope — "drive" is a Google-classified "restricted"
 * scope that requires a paid security review to use on a published app,
 * and fails token requests with "unauthorized_client" without it. There is
 * no `scopes` array to set here in code; the scope is fixed at whatever
 * was granted when the refresh token was issued via the OAuth Playground.
 */
function getDriveClient(): drive_v3.Drive {
  if (cachedClient) return cachedClient;

  const clientId = requireEnv("GOOGLE_OAUTH_CLIENT_ID");
  const clientSecret = requireEnv("GOOGLE_OAUTH_CLIENT_SECRET");
  const refreshToken = requireEnv("GOOGLE_OAUTH_REFRESH_TOKEN");

  const auth = new google.auth.OAuth2(clientId, clientSecret);
  auth.setCredentials({ refresh_token: refreshToken });
  // The googleapis client auto-refreshes the short-lived access token using
  // this refresh token on every call — no manual token management needed.

  cachedClient = google.drive({ version: "v3", auth });
  return cachedClient;
}

/**
 * A normal folder in the authorized account's own personal Drive (e.g.
 * "SELEN Products") — no Shared Drive needed now that Drive access goes
 * through OAuth as that account, not the service account.
 */
function rootFolderId(): string {
  return requireEnv("GOOGLE_DRIVE_ROOT_FOLDER_ID");
}

/**
 * Proof the OAuth refresh token still works AND the configured root folder
 * is actually reachable through it — two separate ways this integration can
 * be broken (revoked/expired token vs. a stale/wrong folder id), both
 * surfaced by one real call. Used by Settings' Integration Status panel.
 */
export async function checkDriveConnection(): Promise<void> {
  const drive = getDriveClient();
  await drive.files.get({
    fileId: rootFolderId(),
    fields: "id, name",
    supportsAllDrives: true,
  });
}

// ── Internal helpers ─────────────────────────────────────────────────────

/** Escapes a name for safe use inside a Drive `q` query string literal. */
function escapeForQuery(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

async function findChild(
  parentId: string,
  name: string,
  extraQuery: string
): Promise<string | null> {
  const drive = getDriveClient();
  const res = await drive.files.list({
    q: `'${parentId}' in parents and name = '${escapeForQuery(name)}' and trashed = false and ${extraQuery}`,
    fields: "files(id, name)",
    spaces: "drive",
    pageSize: 1,
    // Harmless no-ops for a personal Drive folder (the current setup); left
    // in so this keeps working unchanged if the root folder ever moves to a
    // Shared Drive later (e.g. after upgrading to Google Workspace).
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  return res.data.files?.[0]?.id ?? null;
}

const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";

/**
 * The URL every displayed Drive image points at — this app's own
 * /api/drive-image/[fileId] proxy (see that route for why), never a
 * Google-hosted URL directly. Kept relative so callers don't need to know
 * this app's own base URL.
 */
function imageProxyUrl(fileId: string): string {
  return `/api/drive-image/${fileId}`;
}

/**
 * Inverse of imageProxyUrl — pulls the Drive file id back out of a
 * `/api/drive-image/{fileId}` link. Publish (Milestone 9) needs this: the
 * Sheet only ever stores the proxy URL for a picked image (see Review's
 * Continue handler), but publishing to Shopify needs the actual file bytes
 * via downloadFile(), which takes a raw file id, not a URL. Throws on
 * anything that doesn't match — a malformed value here means something
 * upstream saved a link that was never actually one of our own proxy URLs,
 * which is worth failing loudly on rather than silently downloading garbage.
 */
export function driveFileIdFromImageProxyUrl(url: string): string {
  const match = url.match(/\/api\/drive-image\/([^/?#]+)/);
  if (!match) {
    throw new Error(`Not a recognized Drive image URL: ${url}`);
  }
  return decodeURIComponent(match[1]);
}

// ── Public API — matches the spec's function list exactly ──────────────────
// Create Folder / Upload Original / Upload Generated / Get Public Link /
// Rename / Delete.

/**
 * Creates a folder under `parentId`, or returns the existing one if a
 * folder with that name is already there. Idempotent by design — Generate
 * can be retried after a partial failure without creating duplicate
 * folders.
 */
export async function createFolder(name: string, parentId: string): Promise<string> {
  const existing = await findChild(parentId, name, `mimeType = '${FOLDER_MIME_TYPE}'`);
  if (existing) return existing;

  const drive = getDriveClient();
  const res = await drive.files.create({
    requestBody: { name, mimeType: FOLDER_MIME_TYPE, parents: [parentId] },
    fields: "id",
    // Harmless no-op for a personal Drive folder; only matters if this ever
    // points at a Shared Drive instead (see rootFolderId's doc comment).
    supportsAllDrives: true,
  });

  if (!res.data.id) {
    throw new Error(`Google Drive did not return an id when creating folder "${name}".`);
  }
  return res.data.id;
}

export interface UploadResult {
  fileId: string;
  publicUrl: string;
}

async function uploadFile(
  parentFolderId: string,
  fileName: string,
  buffer: Buffer,
  mimeType: string
): Promise<UploadResult> {
  const drive = getDriveClient();
  const existingId = await findChild(parentFolderId, fileName, `mimeType != '${FOLDER_MIME_TYPE}'`);
  const media = { mimeType, body: Readable.from(buffer) };

  let fileId: string;
  if (existingId) {
    await drive.files.update({ fileId: existingId, media, fields: "id", supportsAllDrives: true });
    fileId = existingId;
  } else {
    const res = await drive.files.create({
      requestBody: { name: fileName, parents: [parentFolderId] },
      media,
      fields: "id",
      supportsAllDrives: true,
    });
    if (!res.data.id) {
      throw new Error(`Google Drive did not return an id when uploading "${fileName}".`);
    }
    fileId = res.data.id;
  }

  const publicUrl = await getPublicLink(fileId);
  return { fileId, publicUrl };
}

/** Uploads (or overwrites) a file into a product's `originals` folder. */
export async function uploadOriginal(
  originalsFolderId: string,
  fileName: string,
  buffer: Buffer,
  mimeType: string
): Promise<UploadResult> {
  return uploadFile(originalsFolderId, fileName, buffer, mimeType);
}

/** Uploads (or overwrites) a file into a product's `generated` folder. */
export async function uploadGenerated(
  generatedFolderId: string,
  fileName: string,
  buffer: Buffer,
  mimeType: string
): Promise<UploadResult> {
  return uploadFile(generatedFolderId, fileName, buffer, mimeType);
}

export interface DriveFile {
  name: string;
  publicUrl: string;
}

/**
 * Lists every non-folder file directly inside `folderId`, each already
 * resolved to its public (anyone-with-link) URL — used by the Review screen
 * to reload a previously generated product's images without re-running
 * Leonardo, since generation results themselves aren't stored anywhere
 * besides the in-memory session and this Drive folder.
 */
export async function listFiles(folderId: string): Promise<DriveFile[]> {
  const drive = getDriveClient();
  const res = await drive.files.list({
    q: `'${folderId}' in parents and trashed = false and mimeType != '${FOLDER_MIME_TYPE}'`,
    fields: "files(id, name)",
    spaces: "drive",
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  // Same proxy pattern as getPublicLink — see its doc comment for why this
  // isn't a Google-hosted URL of any kind.
  return (res.data.files ?? []).map((file) => ({
    name: file.name ?? "",
    publicUrl: imageProxyUrl(file.id ?? ""),
  }));
}

/**
 * Returns a URL suitable for embedding directly as an `<img src>` — this
 * app's own `/api/drive-image/[fileId]` proxy (see that route), which
 * streams the file's bytes through `files.get({ alt: "media" })`.
 *
 * Two things were tried and abandoned before this:
 * `webContentLink`/`webViewLink` are built for "download this file" /
 * "open Drive's own viewer page" respectively, and Google frequently serves
 * an HTML interstitial instead of raw image bytes when they're fetched the
 * way an `<img>` tag fetches its `src`. The unofficial
 * `lh3.googleusercontent.com/d/{fileId}` CDN pattern worked around that for
 * a while, but Google has been progressively breaking direct-embed access
 * to that domain as part of tightening third-party cookie handling, so it
 * now intermittently 403s too. Proxying through our own origin sidesteps
 * both failure modes entirely.
 *
 * Still grants "anyone with the link" read access first — not needed for
 * the proxy itself (that reads via this app's own Drive credentials), but
 * harmless and convenient for anyone who wants to open the file directly in
 * Drive's UI from its file id.
 */
export async function getPublicLink(fileId: string): Promise<string> {
  const drive = getDriveClient();
  await drive.permissions.create({
    fileId,
    requestBody: { role: "reader", type: "anyone" },
    supportsAllDrives: true,
  });
  return imageProxyUrl(fileId);
}

/**
 * Renames a file or folder. This is how a product's Drive folder moves
 * from its draft Product ID (e.g. "SP-1A2B3C") to the real AI-generated
 * title once Milestone 7 produces one.
 */
export async function rename(fileOrFolderId: string, newName: string): Promise<void> {
  const drive = getDriveClient();
  await drive.files.update({
    fileId: fileOrFolderId,
    requestBody: { name: newName },
    supportsAllDrives: true,
  });
}

/** Permanently deletes a file or folder (moves it to trash, Drive's default). */
export async function deleteItem(fileOrFolderId: string): Promise<void> {
  const drive = getDriveClient();
  await drive.files.delete({ fileId: fileOrFolderId, supportsAllDrives: true });
}

// ── Orchestration helpers ───────────────────────────────────────────────
// Not in the spec's literal function list, but they compose the primitives
// above into the exact folder structure the spec describes, so the
// orchestration code that will call this service (Milestone 5 onward)
// doesn't have to re-derive it.

export interface ProductFolders {
  categoryFolderId: string;
  productFolderId: string;
  originalsFolderId: string;
  generatedFolderId: string;
}

const CATEGORY_FOLDER_NAMES: Record<ProductType, string> = {
  earrings: "Earrings",
  ring: "Ring",
  pendant: "Pendant",
  necklace: "Necklace",
  bracelet: "Bracelet",
};

/**
 * Ensures "SELEN Products / {Category} / {Product Name} / originals" and
 * ".../generated" all exist, creating only what's missing. `productName`
 * should be the draft Product ID at creation time, then the real title
 * after Milestone 7 — call `rename()` on `productFolderId` when it changes.
 */
export async function ensureProductFolders(
  category: ProductType,
  productName: string
): Promise<ProductFolders> {
  const categoryFolderId = await createFolder(CATEGORY_FOLDER_NAMES[category], rootFolderId());
  const productFolderId = await createFolder(productName, categoryFolderId);
  const [originalsFolderId, generatedFolderId] = await Promise.all([
    createFolder("originals", productFolderId),
    createFolder("generated", productFolderId),
  ]);

  return { categoryFolderId, productFolderId, originalsFolderId, generatedFolderId };
}

/** Writes (or overwrites) `metadata.json` at the root of a product's folder. */
export async function writeMetadataJson(
  productFolderId: string,
  metadata: Record<string, unknown>
): Promise<UploadResult> {
  const buffer = Buffer.from(JSON.stringify(metadata, null, 2), "utf-8");
  return uploadFile(productFolderId, "metadata.json", buffer, "application/json");
}

// ── Upload pool ("Uploads" folder) ──────────────────────────────────────
// A staging area separate from any specific product: someone can snap or
// pick photos ahead of time (e.g. a whole photo-shoot's worth at once),
// and Create Product later pulls individual shots from here instead of
// requiring a local file every time. Deliberately a single flat "Uploads"
// folder rather than a folder per batch/angle — Drive's API has no way to
// query "everything under this folder, including subfolders" in one call,
// so nesting would mean listing every subfolder separately. Tags (angle,
// product type, batch label, etc.) live on each file as Drive
// `appProperties` — private key/value metadata invisible in the Drive UI
// itself, queryable via the API's `q` parameter, and updatable per-key
// without needing to re-send the whole map (Drive merges `appProperties`
// patches, unlike most other fields on files.update).

const POOL_ANGLES = ["front", "side", "worn", "other"] as const;
export type PoolPhotoAngle = (typeof POOL_ANGLES)[number];

export interface PoolPhotoMetadata {
  angle: PoolPhotoAngle;
  productType: ProductType | "";
  batchLabel: string;
  uploadedBy: string;
  notes: string;
}

export interface PoolPhoto extends PoolPhotoMetadata {
  fileId: string;
  name: string;
  publicUrl: string;
  used: boolean;
  usedByProductId: string;
  createdTime: string;
}

async function uploadsFolderId(): Promise<string> {
  return createFolder("Uploads", rootFolderId());
}

function appPropertiesFrom(metadata: Partial<PoolPhotoMetadata & { used: boolean; usedByProductId: string }>): Record<string, string> {
  const props: Record<string, string> = {};
  if (metadata.angle !== undefined) props.angle = metadata.angle;
  if (metadata.productType !== undefined) props.productType = metadata.productType;
  if (metadata.batchLabel !== undefined) props.batchLabel = metadata.batchLabel;
  if (metadata.uploadedBy !== undefined) props.uploadedBy = metadata.uploadedBy;
  if (metadata.notes !== undefined) props.notes = metadata.notes;
  if (metadata.used !== undefined) props.used = String(metadata.used);
  if (metadata.usedByProductId !== undefined) props.usedByProductId = metadata.usedByProductId;
  return props;
}

function poolPhotoFromFile(file: drive_v3.Schema$File): PoolPhoto {
  const props = file.appProperties ?? {};
  return {
    fileId: file.id ?? "",
    name: file.name ?? "",
    // Same proxy pattern as getPublicLink — see its doc comment for why this
    // isn't a Google-hosted URL of any kind.
    publicUrl: imageProxyUrl(file.id ?? ""),
    angle: (props.angle as PoolPhotoAngle) || "other",
    productType: (props.productType as ProductType) || "",
    batchLabel: props.batchLabel ?? "",
    uploadedBy: props.uploadedBy ?? "",
    notes: props.notes ?? "",
    used: props.used === "true",
    usedByProductId: props.usedByProductId ?? "",
    createdTime: file.createdTime ?? "",
  };
}

/** Uploads one photo into the pool, tagged with its angle/type/batch/notes. */
export async function uploadToPool(
  fileName: string,
  buffer: Buffer,
  mimeType: string,
  metadata: PoolPhotoMetadata
): Promise<PoolPhoto> {
  const drive = getDriveClient();
  const folderId = await uploadsFolderId();
  const media = { mimeType, body: Readable.from(buffer) };

  const res = await drive.files.create({
    requestBody: {
      name: fileName,
      parents: [folderId],
      appProperties: appPropertiesFrom({ ...metadata, used: false, usedByProductId: "" }),
    },
    media,
    fields: "id, name, appProperties, createdTime",
    supportsAllDrives: true,
  });

  if (!res.data.id) {
    throw new Error(`Google Drive did not return an id when uploading "${fileName}" to the pool.`);
  }

  // Sets sharing permissions; the URL itself is derived from the file id
  // directly in poolPhotoFromFile, so the return value isn't needed here.
  await getPublicLink(res.data.id);
  return poolPhotoFromFile(res.data);
}

export interface PoolPhotoFilters {
  angle?: PoolPhotoAngle;
  productType?: ProductType;
  unusedOnly?: boolean;
}

/** Lists pool photos, optionally filtered by angle / product type / unused-only. */
export async function listPoolPhotos(filters: PoolPhotoFilters = {}): Promise<PoolPhoto[]> {
  const drive = getDriveClient();
  const folderId = await uploadsFolderId();

  const conditions = [`'${folderId}' in parents`, "trashed = false", `mimeType != '${FOLDER_MIME_TYPE}'`];
  if (filters.angle) {
    conditions.push(`appProperties has { key='angle' and value='${escapeForQuery(filters.angle)}' }`);
  }
  if (filters.productType) {
    conditions.push(`appProperties has { key='productType' and value='${escapeForQuery(filters.productType)}' }`);
  }
  if (filters.unusedOnly) {
    conditions.push(`appProperties has { key='used' and value='false' }`);
  }

  const res = await drive.files.list({
    q: conditions.join(" and "),
    fields: "files(id, name, appProperties, createdTime)",
    orderBy: "createdTime desc",
    spaces: "drive",
    pageSize: 200,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  return (res.data.files ?? []).map(poolPhotoFromFile);
}

/** Tags a pool photo as consumed by a product, so it stops showing up as pickable. */
export async function markPoolPhotoUsed(fileId: string, productId: string): Promise<void> {
  const drive = getDriveClient();
  await drive.files.update({
    fileId,
    requestBody: { appProperties: appPropertiesFrom({ used: true, usedByProductId: productId }) },
    fields: "id",
    supportsAllDrives: true,
  });
}

/** Updates a pool photo's angle tag — used right after upload, when it's still "unlabeled". */
export async function tagPoolPhoto(fileId: string, angle: PoolPhotoAngle): Promise<void> {
  const drive = getDriveClient();
  await drive.files.update({
    fileId,
    requestBody: { appProperties: appPropertiesFrom({ angle }) },
    fields: "id",
    supportsAllDrives: true,
  });
}

/**
 * Removes a photo from the pool entirely. Just a thin, named wrapper over
 * the generic deleteItem — there's no separate index to keep in sync, since
 * listPoolPhotos queries Drive directly (see the "Upload pool" note above),
 * so deleting the file is the whole operation.
 */
export async function deletePoolPhoto(fileId: string): Promise<void> {
  await deleteItem(fileId);
}

/**
 * Downloads a file's raw bytes straight from Drive — used to pull a
 * pool-picked photo's content for image-to-image generation and for
 * copying it into the product's own `originals` folder, the same as a
 * freshly uploaded local file.
 */
export async function downloadFile(fileId: string): Promise<{ buffer: Buffer; mimeType: string; name: string }> {
  const drive = getDriveClient();
  const metaRes = await drive.files.get({
    fileId,
    fields: "name, mimeType",
    supportsAllDrives: true,
  });
  const contentRes = await drive.files.get(
    { fileId, alt: "media", supportsAllDrives: true },
    { responseType: "arraybuffer" }
  );
  return {
    buffer: Buffer.from(contentRes.data as ArrayBuffer),
    mimeType: metaRes.data.mimeType || "image/jpeg",
    name: metaRes.data.name || fileId,
  };
}
