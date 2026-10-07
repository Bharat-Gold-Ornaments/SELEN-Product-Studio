import "server-only";
import { google, type sheets_v4 } from "googleapis";
import { requireEnv, optionalEnv } from "@/lib/env";
import type { ProductRecord, ProductType, ProductStatus } from "@/types/product";
import type { InventoryCategory, InventoryItem } from "@/types/inventory";

// ── Client setup ─────────────────────────────────────────────────────────
// Mirrors services/google-drive.ts: a lazily-created, cached client built
// from the same service-account credentials (share the target Sheet with
// GOOGLE_SERVICE_ACCOUNT_EMAIL the same way the Drive folder is shared —
// and make sure the Google Sheets API is enabled on that service account's
// GCP project, not just the Drive API).

let cachedClient: sheets_v4.Sheets | null = null;

function getSheetsClient(): sheets_v4.Sheets {
  if (cachedClient) return cachedClient;

  const email = requireEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL");
  const privateKey = requireEnv("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY").replace(/\\n/g, "\n");

  const auth = new google.auth.JWT({
    email,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  cachedClient = google.sheets({ version: "v4", auth });
  return cachedClient;
}

function spreadsheetId(): string {
  return requireEnv("GOOGLE_SHEETS_ID");
}

function tabName(): string {
  return optionalEnv("GOOGLE_SHEETS_TAB_NAME", "Products");
}

// batchUpdate's deleteDimension request needs the tab's numeric sheetId
// (Sheets' own internal id for that tab, distinct from spreadsheetId and
// from its name) — nothing else in this file needs it, since values.get/
// .update/.append all address ranges by tab name instead. Cached per server
// instance; a tab is never renamed or recreated mid-session.
let cachedSheetId: number | null = null;

async function getSheetId(): Promise<number> {
  if (cachedSheetId !== null) return cachedSheetId;
  const sheets = getSheetsClient();

  const res = await sheets.spreadsheets.get({
    spreadsheetId: spreadsheetId(),
    fields: "sheets.properties(sheetId,title)",
  });
  const match = res.data.sheets?.find((s) => s.properties?.title === tabName());
  if (!match?.properties?.sheetId && match?.properties?.sheetId !== 0) {
    throw new Error(`Couldn't find a tab named "${tabName()}" in the configured spreadsheet.`);
  }
  cachedSheetId = match.properties.sheetId;
  return cachedSheetId;
}

/**
 * Proof the service account credentials work AND the configured spreadsheet
 * is actually shared with them — a cheap metadata-only read (just the
 * title), not a full row fetch. Used by Settings' Integration Status panel.
 */
export async function checkSheetsConnection(): Promise<void> {
  const sheets = getSheetsClient();
  await sheets.spreadsheets.get({
    spreadsheetId: spreadsheetId(),
    fields: "properties.title",
  });
}

// ── Row <-> ProductRecord mapping ───────────────────────────────────────
// One column per ProductRecord field, in this exact order — A through Z.
// Every product type's type-specific fields (ringSize, claspType, etc.) get
// their own column and are simply blank for types that don't use them, so
// the sheet stays a single flat, human-readable table across all 5 types.
//
// IMPORTANT: this order is positional, not name-keyed — Google Sheets has
// no idea "column E" means "tags", it just has whatever's in row N, column
// E. Every row already written to a real spreadsheet was written using
// whatever COLUMNS order existed at the time. Inserting a new field in the
// middle of this array (instead of appending it at the end) silently
// shifts every column after it for every row written before the change,
// while newly-written rows use the new layout — the two become misaligned
// and old rows get read back with the wrong field in the wrong column
// (this exact bug happened once: adding tags/seoTitle/metaDescription
// right after `description` broke `createdDate` for every pre-existing
// row, since it now pointed at what used to be `shopifyProductId`'s
// neighbor instead). Any future field must be appended after
// `shopifyProductId`, never inserted earlier in this list.
const COLUMNS = [
  "productId",
  "category",
  "title",
  "description",
  "weightGrams",
  "lengthCm",
  "widthCm",
  "finish",
  "stone",
  "hookType",
  "ringSize",
  "bandWidthMm",
  "claspType",
  "chainIncluded",
  "collections",
  "inventory",
  "status",
  "driveFolder",
  "heroImageLink",
  "lifestyleImageLink",
  "closeupImageLink",
  "createdDate",
  "shopifyProductId",
  // Appended for Milestone 7 (AI copy) — see the comment above for why
  // these live at the end rather than near title/description.
  "tags",
  "seoTitle",
  "metaDescription",
  // Appended for Milestone 9 (Finalize + Publish) — same append-only rule.
  "price",
  // Appended for the Admin Pricing Dashboard feature — same append-only
  // rule. `weightGrams` above continues to double as Gross Weight.
  "netWeightGrams",
  "makingChargeMode",
  "makingChargeValue",
  "stoneLineItems",
  "manualPriceOverride",
  "priceSyncStatus",
  "priceSyncedAt",
  // Appended for post-publish listing edits (Update Shopify Listing) — same
  // append-only rule.
  "listingSyncStatus",
  "listingSyncedAt",
  // Appended for the Variants (Color/Size) feature — same append-only rule.
  "variants",
  "variantsSyncStatus",
  "variantsSyncedAt",
  // Appended for per-color AI-generated variant photos — same append-only rule.
  "variantColorImages",
  // Appended for post-publish inventory sync (variant-less products) — same append-only rule.
  "inventorySyncStatus",
  "inventorySyncedAt",
] as const satisfies readonly (keyof ProductRecord)[];

// Converts a 0-based column index to its Sheets column letter(s) — A, B, ...
// Z, AA, AB, ... Derived from COLUMNS.length rather than hand-counted, so
// adding a column here never requires remembering to bump a hardcoded
// letter (COLUMNS grew past 26 with Milestone 9's `price`, so this can no
// longer just be a single letter).
function columnLetter(zeroBasedIndex: number): string {
  let n = zeroBasedIndex + 1;
  let letters = "";
  while (n > 0) {
    const remainder = (n - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

const LAST_COLUMN_LETTER = columnLetter(COLUMNS.length - 1);

function fullRange(): string {
  return `${tabName()}!A:${LAST_COLUMN_LETTER}`;
}

function headerRange(): string {
  return `${tabName()}!A1:${LAST_COLUMN_LETTER}1`;
}

function rowRange(rowNumber: number): string {
  return `${tabName()}!A${rowNumber}:${LAST_COLUMN_LETTER}${rowNumber}`;
}

function cellValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}

function recordToRow(record: ProductRecord): string[] {
  return COLUMNS.map((key) => cellValue(record[key]));
}

function parseNullableNumber(value: string): number | null {
  if (value === "") return null;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function parseNullableString(value: string): string | null {
  return value === "" ? null : value;
}

function rowToRecord(row: string[]): ProductRecord {
  const get = (i: number) => row[i] ?? "";
  return {
    productId: get(0),
    category: get(1) as ProductType,
    title: get(2),
    description: get(3),
    weightGrams: Number(get(4)) || 0,
    lengthCm: parseNullableNumber(get(5)),
    widthCm: parseNullableNumber(get(6)),
    finish: get(7),
    stone: get(8),
    hookType: parseNullableString(get(9)),
    ringSize: parseNullableString(get(10)),
    bandWidthMm: parseNullableNumber(get(11)),
    claspType: parseNullableString(get(12)),
    chainIncluded: get(13) === "" ? null : get(13).toLowerCase() === "true",
    collections: get(14)
      ? get(14)
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : [],
    inventory: Number(get(15)) || 0,
    status: (get(16) || "draft") as ProductStatus,
    driveFolder: get(17),
    heroImageLink: get(18),
    lifestyleImageLink: get(19),
    closeupImageLink: get(20),
    createdDate: get(21),
    shopifyProductId: parseNullableString(get(22)),
    tags: get(23)
      ? get(23)
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : [],
    seoTitle: get(24),
    metaDescription: get(25),
    price: Number(get(26)) || 0,
    netWeightGrams: Number(get(27)) || 0,
    makingChargeMode: get(28) === "flat" ? "flat" : "per_gram",
    makingChargeValue: Number(get(29)) || 0,
    stoneLineItems: get(30),
    manualPriceOverride: get(31).toLowerCase() === "true",
    priceSyncStatus: ((): ProductRecord["priceSyncStatus"] => {
      const raw = get(32);
      return raw === "synced" || raw === "out_of_sync" ? raw : "";
    })(),
    priceSyncedAt: get(33),
    listingSyncStatus: ((): ProductRecord["listingSyncStatus"] => {
      const raw = get(34);
      return raw === "synced" || raw === "out_of_sync" ? raw : "";
    })(),
    listingSyncedAt: get(35),
    variants: get(36),
    variantsSyncStatus: ((): ProductRecord["variantsSyncStatus"] => {
      const raw = get(37);
      return raw === "synced" || raw === "out_of_sync" ? raw : "";
    })(),
    variantsSyncedAt: get(38),
    variantColorImages: get(39),
    inventorySyncStatus: ((): ProductRecord["inventorySyncStatus"] => {
      const raw = get(40);
      return raw === "synced" || raw === "out_of_sync" ? raw : "";
    })(),
    inventorySyncedAt: get(41),
  };
}

// ── Header row ───────────────────────────────────────────────────────────
// Written once, the first time the sheet is ever touched — idempotent, and
// cheap enough (cached per server instance) to check on every call rather
// than requiring a separate manual setup step.

let headerEnsured = false;

/**
 * Grows the tab's actual column grid to fit COLUMNS if it's currently
 * narrower. A sheet's grid has a fixed width independent of how many
 * columns actually have data in them — a tab created (or last resized)
 * before a field was appended to COLUMNS can have fewer real grid columns
 * than COLUMNS now needs, and Sheets refuses to write into a column past
 * the grid's current width even via values.update ("Range ... exceeds grid
 * limits: Max columns: N"), the same failure mode deleteProductRow's
 * deleteDimension would hit on a too-narrow *row* count. Called once per
 * server instance from ensureHeaderRow, before it ever tries to write a
 * header cell out there. Also opportunistically caches sheetId, same value
 * getSheetId fetches separately, so a later deleteProductRow call in this
 * instance doesn't need its own round trip.
 */
async function ensureColumnCapacity(): Promise<void> {
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.get({
    spreadsheetId: spreadsheetId(),
    fields: "sheets.properties(sheetId,title,gridProperties.columnCount)",
  });
  const match = res.data.sheets?.find((s) => s.properties?.title === tabName());
  const sheetId = match?.properties?.sheetId;
  if (sheetId == null) return;
  cachedSheetId = sheetId;

  const columnCount = match?.properties?.gridProperties?.columnCount ?? 0;
  if (columnCount >= COLUMNS.length) return;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: spreadsheetId(),
    requestBody: {
      requests: [
        {
          appendDimension: {
            sheetId,
            dimension: "COLUMNS",
            length: COLUMNS.length - columnCount,
          },
        },
      ],
    },
  });
}

async function ensureHeaderRow(): Promise<void> {
  if (headerEnsured) return;
  const sheets = getSheetsClient();
  await ensureColumnCapacity();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: spreadsheetId(),
    range: headerRange(),
  });

  const existing = res.data.values?.[0] ?? [];
  if (existing.length === 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: spreadsheetId(),
      range: headerRange(),
      valueInputOption: "RAW",
      requestBody: { values: [[...COLUMNS]] },
    });
  } else if (existing.length < COLUMNS.length) {
    // A sheet from before a field was added (e.g. tags/seoTitle/
    // metaDescription in Milestone 7) already has a header row, just a
    // shorter one — top up only the missing trailing header cells rather
    // than overwriting the whole row. Since new fields are always appended
    // at the end (see the comment on COLUMNS above), this never touches an
    // existing header cell, so any row already written stays correctly
    // aligned with its column headers.
    const missingHeaders = COLUMNS.slice(existing.length);
    const startLetter = columnLetter(existing.length);
    await sheets.spreadsheets.values.update({
      spreadsheetId: spreadsheetId(),
      range: `${tabName()}!${startLetter}1:${LAST_COLUMN_LETTER}1`,
      valueInputOption: "RAW",
      requestBody: { values: [missingHeaders] },
    });
  }
  headerEnsured = true;
}

// ── Public API ───────────────────────────────────────────────────────────

/** Every product row currently in the sheet, in sheet order (oldest first). */
export async function listProducts(): Promise<ProductRecord[]> {
  await ensureHeaderRow();
  const sheets = getSheetsClient();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: spreadsheetId(),
    range: `${tabName()}!A2:${LAST_COLUMN_LETTER}`,
  });

  const rows = res.data.values ?? [];
  return rows
    .filter((row) => row.some((value) => value !== "" && value != null))
    .map((row) => rowToRecord(row.map((value) => (value == null ? "" : String(value)))));
}

export interface ProductRowLookup {
  record: ProductRecord;
  /** 1-based row number in the sheet (including the header row), for updateProductRow. */
  rowNumber: number;
}

/** Finds a product by ID. Returns null if no row matches. */
export async function findProduct(productId: string): Promise<ProductRowLookup | null> {
  await ensureHeaderRow();
  const sheets = getSheetsClient();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: spreadsheetId(),
    range: `${tabName()}!A2:${LAST_COLUMN_LETTER}`,
  });

  const rows = res.data.values ?? [];
  const index = rows.findIndex((row) => row[0] === productId);
  if (index === -1) return null;

  const row = rows[index].map((value) => (value == null ? "" : String(value)));
  return { record: rowToRecord(row), rowNumber: index + 2 }; // +1 for 0-index, +1 for header row
}

/**
 * Appends a new product row. Doesn't check for an existing row with the
 * same productId first — callers create one row per product exactly once,
 * at Generate time, so this is intentionally an append, not an upsert.
 */
export async function appendProductRow(record: ProductRecord): Promise<void> {
  await ensureHeaderRow();
  const sheets = getSheetsClient();

  await sheets.spreadsheets.values.append({
    spreadsheetId: spreadsheetId(),
    range: fullRange(),
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [recordToRow(record)] },
  });
}

/**
 * Patches an existing product row by productId — reads the current row,
 * merges the patch over it, and rewrites the whole row (simpler and just as
 * cheap as a partial-cell update for a 24-column row). Throws if no row
 * with that productId exists; callers that aren't sure one exists yet
 * should check with findProduct first.
 */
export async function updateProductRow(productId: string, patch: Partial<ProductRecord>): Promise<void> {
  const existing = await findProduct(productId);
  if (!existing) {
    throw new Error(`No Google Sheet row found for product ${productId} — can't update a row that doesn't exist.`);
  }

  const merged: ProductRecord = { ...existing.record, ...patch };
  const sheets = getSheetsClient();

  await sheets.spreadsheets.values.update({
    spreadsheetId: spreadsheetId(),
    range: rowRange(existing.rowNumber),
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [recordToRow(merged)] },
  });
}

/**
 * Deletes a product's row entirely. Unlike updateProductRow, this can't just
 * address the row by range — Sheets has no "delete this range" operation
 * that shifts everything below it up, only `deleteDimension`, which removes
 * a whole row index from the tab. Throws if no row with that productId
 * exists; callers should check with findProduct first (the DELETE route
 * already needs to, to read status/category before deleting).
 */
export async function deleteProductRow(productId: string): Promise<void> {
  const existing = await findProduct(productId);
  if (!existing) {
    throw new Error(`No Google Sheet row found for product ${productId} — can't delete a row that doesn't exist.`);
  }

  const sheets = getSheetsClient();
  const sheetId = await getSheetId();
  // rowNumber is 1-based and includes the header row; deleteDimension's
  // startIndex/endIndex are 0-based, so rowNumber (1-based) is already the
  // correct 0-based startIndex — e.g. row 2 (the first data row) has
  // 0-based sheet index 1.
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: spreadsheetId(),
    requestBody: {
      requests: [
        {
          deleteDimension: {
            range: {
              sheetId,
              dimension: "ROWS",
              startIndex: existing.rowNumber - 1,
              endIndex: existing.rowNumber,
            },
          },
        },
      ],
    },
  });
}

// ── Inventory tab ────────────────────────────────────────────────────────
// A second, independent tab in the same spreadsheet backing the Inventory
// page — a simple stock register (code, category, weight, photo, Shopify
// id), unrelated to the Products tab's generation pipeline above. Same
// append-only column rule as COLUMNS applies here.

const INVENTORY_COLUMNS = [
  "sku",
  "category",
  "weightGrams",
  "photoUrl",
  "shopifyProductId",
  "createdDate",
  "quantity",
] as const satisfies readonly (keyof InventoryItem)[];

const INVENTORY_LAST_COLUMN_LETTER = columnLetter(INVENTORY_COLUMNS.length - 1);

function inventoryTabName(): string {
  return optionalEnv("GOOGLE_SHEETS_INVENTORY_TAB_NAME", "Inventory");
}

let inventoryTabEnsured = false;

/**
 * Creates the Inventory tab (with its header row) the first time it's
 * needed, so there's no manual setup step in the spreadsheet. Unlike
 * ensureHeaderRow, the tab itself may not exist yet — values.get on a
 * missing tab errors rather than returning empty.
 */
async function ensureInventoryTab(): Promise<void> {
  if (inventoryTabEnsured) return;
  const sheets = getSheetsClient();

  const res = await sheets.spreadsheets.get({
    spreadsheetId: spreadsheetId(),
    fields: "sheets.properties.title",
  });
  const exists = res.data.sheets?.some((s) => s.properties?.title === inventoryTabName());
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: spreadsheetId(),
      requestBody: { requests: [{ addSheet: { properties: { title: inventoryTabName() } } }] },
    });
  }

  const header = await sheets.spreadsheets.values.get({
    spreadsheetId: spreadsheetId(),
    range: `${inventoryTabName()}!A1:${INVENTORY_LAST_COLUMN_LETTER}1`,
  });
  // Rewrites the whole header whenever it differs — covers a brand-new tab,
  // a column appended since, and a renamed column (column A started out as
  // "productCode" before becoming "sku"). Safe because positions never move.
  const existing = header.data.values?.[0] ?? [];
  if (INVENTORY_COLUMNS.some((name, i) => existing[i] !== name)) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: spreadsheetId(),
      range: `${inventoryTabName()}!A1:${INVENTORY_LAST_COLUMN_LETTER}1`,
      valueInputOption: "RAW",
      requestBody: { values: [[...INVENTORY_COLUMNS]] },
    });
  }
  inventoryTabEnsured = true;
}

// Numbers stay numbers (so weight/quantity sum in the sheet); everything
// else is written as text.
function inventoryItemToRow(item: InventoryItem): (string | number)[] {
  return INVENTORY_COLUMNS.map((key) => {
    const value = item[key];
    return typeof value === "number" ? value : String(value ?? "");
  });
}

function rowToInventoryItem(row: string[]): InventoryItem {
  const get = (i: number) => row[i] ?? "";
  return {
    sku: get(0),
    category: get(1) as InventoryCategory,
    weightGrams: Number(get(2)) || 0,
    photoUrl: get(3),
    shopifyProductId: get(4),
    createdDate: get(5),
    // Rows written before this column existed were one piece each.
    quantity: get(6) === "" ? 1 : Number(get(6)) || 0,
  };
}

/** Every Inventory row, in sheet order (oldest first). */
export async function listInventoryItems(): Promise<InventoryItem[]> {
  await ensureInventoryTab();
  const sheets = getSheetsClient();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: spreadsheetId(),
    range: `${inventoryTabName()}!A2:${INVENTORY_LAST_COLUMN_LETTER}`,
  });

  return (res.data.values ?? [])
    .filter((row) => row.some((value) => value !== "" && value != null))
    .map((row) => rowToInventoryItem(row.map((value) => (value == null ? "" : String(value)))));
}

/**
 * Appends one Inventory row. RAW rather than USER_ENTERED (which the
 * Products tab uses) so a product code like "00123" or a numeric Shopify id
 * is kept verbatim as text instead of being reinterpreted as a number;
 * weight and quantity are passed as actual numbers so they still sum in
 * the sheet.
 */
export async function appendInventoryRow(item: InventoryItem): Promise<void> {
  await ensureInventoryTab();
  const sheets = getSheetsClient();

  await sheets.spreadsheets.values.append({
    spreadsheetId: spreadsheetId(),
    range: `${inventoryTabName()}!A:${INVENTORY_LAST_COLUMN_LETTER}`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [inventoryItemToRow(item)] },
  });
}

export interface InventoryUpdate {
  category?: InventoryCategory;
  weightGrams?: number;
  shopifyProductId?: string;
  /** Absolute quantity — the Edit dialog. */
  quantity?: number;
  /**
   * Relative change — the table's +/- buttons. Applied to the row's value as
   * read here rather than to whatever the browser last saw, so two quick
   * clicks (or two people) don't overwrite each other's change.
   */
  quantityDelta?: number;
}

/**
 * Rewrites one Inventory row, found by SKU (case-insensitive, matching the
 * duplicate check in POST /api/inventory). Quantity is floored at 0. Throws
 * if no row has that SKU.
 */
export async function updateInventoryRow(sku: string, update: InventoryUpdate): Promise<InventoryItem> {
  await ensureInventoryTab();
  const sheets = getSheetsClient();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: spreadsheetId(),
    range: `${inventoryTabName()}!A2:${INVENTORY_LAST_COLUMN_LETTER}`,
  });
  const rows = res.data.values ?? [];
  const index = rows.findIndex((row) => String(row[0] ?? "").toLowerCase() === sku.toLowerCase());
  if (index === -1) {
    throw new Error(`No inventory row found for SKU ${sku}.`);
  }

  const current = rowToInventoryItem(rows[index].map((value) => (value == null ? "" : String(value))));
  const { quantityDelta, ...fields } = update;
  const merged: InventoryItem = { ...current, ...fields };
  if (quantityDelta !== undefined) merged.quantity = current.quantity + quantityDelta;
  merged.quantity = Math.max(0, merged.quantity);

  const rowNumber = index + 2; // +1 for 0-index, +1 for header row
  await sheets.spreadsheets.values.update({
    spreadsheetId: spreadsheetId(),
    range: `${inventoryTabName()}!A${rowNumber}:${INVENTORY_LAST_COLUMN_LETTER}${rowNumber}`,
    valueInputOption: "RAW",
    requestBody: { values: [inventoryItemToRow(merged)] },
  });
  return merged;
}
