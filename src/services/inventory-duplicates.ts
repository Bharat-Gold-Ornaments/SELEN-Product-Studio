import "server-only";
import { readConfigFile, writeConfigFile } from "@/services/google-drive";
import { duplicatePairKey } from "@/lib/inventory-duplicates";

const DISMISSALS_FILE = "inventory-duplicate-dismissals.json";

/**
 * Pairs someone marked "Not a duplicate" on the Inventory page, as pair keys
 * (see duplicatePairKey). Kept in Drive's Config folder next to the app
 * settings, so every device sees the same list.
 */
export async function listDismissedDuplicatePairs(): Promise<string[]> {
  const raw = await readConfigFile(DISMISSALS_FILE);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as { pairs?: unknown };
    return Array.isArray(parsed.pairs) ? parsed.pairs.filter((p): p is string => typeof p === "string") : [];
  } catch {
    return [];
  }
}

export async function dismissDuplicatePair(skuA: string, skuB: string): Promise<string[]> {
  const pairs = new Set(await listDismissedDuplicatePairs());
  pairs.add(duplicatePairKey(skuA, skuB));
  const next = [...pairs].sort();
  await writeConfigFile(DISMISSALS_FILE, JSON.stringify({ pairs: next }, null, 2));
  return next;
}
