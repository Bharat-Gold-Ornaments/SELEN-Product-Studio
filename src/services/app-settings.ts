import "server-only";
import { promises as fs } from "fs";
import path from "path";
import { DEFAULT_GENERATION_COUNTS } from "@/lib/constants";
import type { ImageCategory } from "@/types/product";

// Same storage model as services/templates.ts: a real file on disk, read
// fresh (no in-memory cache — this is edited rarely, from one place, by one
// admin, so staleness isn't worth trading for the complexity of cache
// invalidation), which persists immediately in local/non-serverless
// deployments. On Vercel specifically the filesystem is read-only at
// runtime, so a saved change won't survive past the current invocation —
// same documented limitation as templates.ts, and for the same reason
// (nothing else in this app has a database to persist small admin-editable
// values to). If that becomes a real problem, this is the one file that
// would need to move to Sheets, Drive, or a proper KV store — every caller
// goes through readAppSettings()/writeAppSettings() so the storage swap
// wouldn't ripple elsewhere.
const SETTINGS_FILE = path.join(process.cwd(), "data", "app-settings.json");

export interface AppSettings {
  /** How many images Leonardo generates per category by default — see services/leonardo.ts. */
  generationCounts: Record<ImageCategory, number>;
}

const DEFAULTS: AppSettings = {
  generationCounts: { ...DEFAULT_GENERATION_COUNTS },
};

/**
 * Reads current settings, falling back to DEFAULTS for anything missing —
 * including the whole file not existing yet (first run, before Settings has
 * ever been saved). Never throws for that reason; a missing/partial file is
 * the expected, common case, not an error.
 */
export async function readAppSettings(): Promise<AppSettings> {
  try {
    const raw = await fs.readFile(SETTINGS_FILE, "utf-8");
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return {
      generationCounts: { ...DEFAULTS.generationCounts, ...parsed.generationCounts },
    };
  } catch {
    return DEFAULTS;
  }
}

export interface AppSettingsPatch {
  /** Only the categories being changed need to be present — see the PATCH schema in api/settings/route.ts, which sends just the edited fields. */
  generationCounts?: Partial<Record<ImageCategory, number>>;
}

/** Merges `patch` over the current settings and writes the result. Returns the merged settings. */
export async function writeAppSettings(patch: AppSettingsPatch): Promise<AppSettings> {
  const current = await readAppSettings();
  const next: AppSettings = {
    generationCounts: { ...current.generationCounts, ...patch.generationCounts },
  };
  await fs.mkdir(path.dirname(SETTINGS_FILE), { recursive: true });
  await fs.writeFile(SETTINGS_FILE, JSON.stringify(next, null, 2), "utf-8");
  return next;
}
