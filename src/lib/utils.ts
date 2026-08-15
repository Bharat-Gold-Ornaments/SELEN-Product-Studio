import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge Tailwind class names, resolving conflicts (last one wins).
 * Standard shadcn/ui helper.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Format a number of grams for display, e.g. 4.5 -> "4.5g".
 */
export function formatGrams(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `${value}g`;
}

/**
 * Format a date consistently across the app (server + client safe, no locale
 * surprises). Returns "—" (matching formatGrams' convention for missing
 * data) instead of throwing when `date` doesn't parse to a valid Date —
 * e.g. an empty string, which `new Date("")` turns into an Invalid Date
 * that Intl.DateTimeFormat then throws on. A row with a genuinely blank
 * createdDate (a partially-written Sheets row, a column-alignment bug, a
 * still-processing product, etc.) should render a placeholder, not crash
 * the whole page.
 */
export function formatDate(date: string | number | Date): string {
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(parsed);
}

/**
 * Turn a product title into a Shopify-safe handle.
 * e.g. "Golden Bloom Hoops" -> "golden-bloom-hoops"
 */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Client-side draft Product ID, used to name the Drive folder/Sheet row
 * before the record exists in Google Sheets. Milestone 8's `appendProduct`
 * is the source of truth and may assign/confirm a final ID; until then this
 * keeps every draft addressable.
 */
export function generateProductId(): string {
  const stamp = Date.now().toString(36).toUpperCase();
  return `SP-${stamp}`;
}
