import "server-only";
import { DEFAULT_GENERATION_COUNTS } from "@/lib/constants";
import { readConfigFile, writeConfigFile } from "@/services/google-drive";
import type { ImageCategory } from "@/types/product";
import type { MakingChargeMode } from "@/lib/pricing";

const SETTINGS_FILE = "app-settings.json";

export type ImageProvider = "kie" | "leonardo";

export interface AppSettings {
  /** How many images the active image provider generates per category by default — see services/image-generation.ts. */
  generationCounts: Record<ImageCategory, number>;
  /**
   * Which image generation provider is active — see services/image-generation.ts
   * for the dispatch. Defaults to "kie": Leonardo's GPT Image 2 model turned
   * out to have an undocumented prompt-length limit that some of this app's
   * longer templates exceed, so Kie (same underlying GPT Image 2 model, via
   * a different aggregator) is the default while Leonardo stays available as
   * a toggle rather than being removed.
   */
  imageProvider: ImageProvider;
  /** Current metal (silver) rate, ₹ per gram — the one global pricing input every product's formula reads. See src/lib/pricing.ts. */
  ratePerGram: number;
  /** Pre-fills new products' Making Charge Mode selector — never inferred, always an explicit per-product choice, this is just the starting value. */
  defaultMakingChargeMode: MakingChargeMode;
}

const DEFAULTS: AppSettings = {
  generationCounts: { ...DEFAULT_GENERATION_COUNTS },
  imageProvider: "kie",
  ratePerGram: 0,
  defaultMakingChargeMode: "per_gram",
};

/**
 * Reads current settings from Google Drive's "Config" folder, falling back
 * to DEFAULTS for anything missing — including the whole file not existing
 * yet (first run, before Settings has ever been saved). Never throws for
 * that reason; a missing/partial file is the expected, common case, not an
 * error. Previously read/wrote a local data/app-settings.json file, which
 * threw EROFS the moment anyone saved a change from a deployed (Vercel)
 * instance — same bug, and same fix, as services/templates.ts.
 */
export async function readAppSettings(): Promise<AppSettings> {
  try {
    const raw = await readConfigFile(SETTINGS_FILE);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return {
      generationCounts: { ...DEFAULTS.generationCounts, ...parsed.generationCounts },
      imageProvider: parsed.imageProvider ?? DEFAULTS.imageProvider,
      ratePerGram: parsed.ratePerGram ?? DEFAULTS.ratePerGram,
      defaultMakingChargeMode: parsed.defaultMakingChargeMode ?? DEFAULTS.defaultMakingChargeMode,
    };
  } catch {
    return DEFAULTS;
  }
}

export interface AppSettingsPatch {
  /** Only the categories being changed need to be present — see the PATCH schema in api/settings/route.ts, which sends just the edited fields. */
  generationCounts?: Partial<Record<ImageCategory, number>>;
  imageProvider?: ImageProvider;
  ratePerGram?: number;
  defaultMakingChargeMode?: MakingChargeMode;
}

/**
 * Merges `patch` over the current settings and writes the result. Returns
 * the merged settings. Deliberately doesn't log rate changes itself — a
 * `ratePerGram` change made through here (vs. through
 * services/pricing.ts's updateGlobalRate) skips the audit log, so this stays
 * a plain settings writer; only updateGlobalRate is the audited path for
 * changing the rate, matching Section 9 of the pricing spec.
 */
export async function writeAppSettings(patch: AppSettingsPatch): Promise<AppSettings> {
  const current = await readAppSettings();
  const next: AppSettings = {
    generationCounts: { ...current.generationCounts, ...patch.generationCounts },
    imageProvider: patch.imageProvider ?? current.imageProvider,
    ratePerGram: patch.ratePerGram ?? current.ratePerGram,
    defaultMakingChargeMode: patch.defaultMakingChargeMode ?? current.defaultMakingChargeMode,
  };
  await writeConfigFile(SETTINGS_FILE, JSON.stringify(next, null, 2));
  return next;
}
