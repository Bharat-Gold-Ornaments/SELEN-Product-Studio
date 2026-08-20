import { NextResponse } from "next/server";
import { z } from "zod";
import { readAppSettings, writeAppSettings } from "@/services/app-settings";

export async function GET() {
  const settings = await readAppSettings();
  return NextResponse.json(settings);
}

// Capped at 6 per category — beyond that, a single Generate click fans out
// into a lot of Leonardo generations at once; 6 is a generous ceiling for a
// per-product photo set without making a fat-fingered "60" an expensive
// accident.
const countField = z.number().int().min(1, "Must be at least 1").max(6, "6 is the max per category").optional();

const patchSchema = z.object({
  generationCounts: z
    .object({
      hero: countField,
      lifestyle: countField,
      closeup: countField,
    })
    .optional(),
  imageProvider: z.enum(["kie", "leonardo"]).optional(),
  // Rate/gram itself is deliberately NOT accepted here — the only audited
  // path for changing it is POST /api/pricing/update-all (see
  // services/pricing.ts's updateGlobalRate doc comment). Only the
  // per-product default pre-fill goes through this generic settings patch.
  defaultMakingChargeMode: z.enum(["flat", "per_gram"]).optional(),
});

/** Saves the Default Generation Counts form on Settings. */
export async function PATCH(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request body." }, { status: 400 });
  }

  try {
    const settings = await writeAppSettings(parsed.data);
    return NextResponse.json(settings);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Couldn't save settings." },
      { status: 500 }
    );
  }
}
