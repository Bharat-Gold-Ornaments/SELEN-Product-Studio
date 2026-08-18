import "server-only";
import { DEFAULT_GENERATION_COUNTS } from "@/lib/constants";
import { readConfigFile, writeConfigFile } from "@/services/google-drive";
import type { ImageCategory } from "@/types/product";

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
}

const DEFAULTS: AppSettings = {
  generationCounts: { ...DEFAULT_GENERATION_COUNTS },
  imageProvider: "kie",
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
    };
  } catch {
    return DEFAULTS;
  }
}

export interface AppSettingsPatch {
  /** Only the categories being changed need to be present — see the PATCH schema in api/settings/route.ts, which sends just the edited fields. */
  generationCounts?: Partial<Record<ImageCategory, number>>;
  imageProvider?: ImageProvider;
}

/** Merges `patch` over the current settings and writes the result. Returns the merged settings. */
export async function writeAppSettings(patch: AppSettingsPatch): Promise<AppSettings> {
  const current = await readAppSettings();
  const next: AppSettings = {
    generationCounts: { ...current.generationCounts, ...patch.generationCounts },
    imageProvider: patch.imageProvider ?? current.imageProvider,
  };
  await writeConfigFile(SETTINGS_FILE, JSON.stringify(next, null, 2));
  return next;
}
