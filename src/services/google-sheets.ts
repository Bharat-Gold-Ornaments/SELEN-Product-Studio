import "server-only";
import { google, type sheets_v4 } from "googleapis";
import { requireEnv, optionalEnv } from "@/lib/env";
import type { ProductRecord, ProductType, ProductStatus } from "@/types/product";

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
  };
}

// ── Header row ───────────────────────────────────────────────────────────
// Written once, the first time the sheet is ever touched — idempotent, and
// cheap enough (cached per server instance) to check on every call rather
// than requiring a separate manual setup step.

let headerEnsured = false;

async function ensureHeaderRow(): Promise<void> {
  if (headerEnsured) return;
  const sheets = getSheetsClient();

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
