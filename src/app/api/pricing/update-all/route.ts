import { NextResponse } from "next/server";
import { z } from "zod";
import { updateAllPrices } from "@/services/pricing";

export const maxDuration = 60;

const bodySchema = z.object({
  ratePerGram: z.number().positive("Rate/gram must be a positive number."),
});

/**
 * Settings' "Update All Prices" button — the one audited, confirmed path
 * for changing the global Rate/gram (see services/pricing.ts's
 * updateGlobalRate/updateAllPrices). The confirmation modal itself lives in
 * the Settings UI; by the time this route runs, the user has already
 * confirmed the exact scope-of-change copy from the spec.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request body." }, { status: 400 });
  }

  try {
    const result = await updateAllPrices(parsed.data.ratePerGram);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Couldn't update prices." },
      { status: 502 }
    );
  }
}
