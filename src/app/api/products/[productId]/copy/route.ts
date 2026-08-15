import { NextResponse } from "next/server";
import { z } from "zod";
import {
  generateAllCopy,
  generateCopyField,
  type CopyFieldResult,
  type SeoCopy,
} from "@/services/anthropic-copy";
import { updateProductRow } from "@/services/google-sheets";
import type { ImagePromptVariables } from "@/lib/generation-variables";

export const maxDuration = 60;

const variablesSchema = z.object({
  productType: z.string(),
  finish: z.string(),
  stone: z.string(),
  dimensions: z.string(),
  collections: z.string(),
});

const postSchema = z.object({
  field: z.enum(["all", "title", "description", "tags", "seo"]),
  variables: variablesSchema,
  // Current title (approved or edited on screen) — required for every
  // field except "title" itself, since description/tags/SEO all reference
  // it. See generateCopyField's doc comment in services/anthropic-copy.ts.
  title: z.string().optional(),
});

/**
 * Generates product copy for the Review screen. `field: "all"` runs the
 * full title -> description/tags/SEO chain (services/anthropic-copy.ts);
 * any other field regenerates just that one, reusing whatever title is
 * currently on screen. Never writes to Google Sheets — that only happens
 * once the user approves the copy and hits Continue (see the PATCH handler
 * below).
 */
// Not scoped to :productId at all — generating copy doesn't touch Google
// Sheets or Drive, it only needs the variables the caller already has on
// screen. Saving (which is per-product) happens in PATCH below.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const { field, variables, title } = parsed.data;

  if (field === "all") {
    const result = await generateAllCopy(variables as ImagePromptVariables);
    return NextResponse.json({ result });
  }

  const result: CopyFieldResult<string | string[] | SeoCopy> = await generateCopyField(
    field,
    variables as ImagePromptVariables,
    title
  );
  return NextResponse.json({ field, result });
}

const patchSchema = z.object({
  title: z.string().min(1, "Title can't be empty."),
  description: z.string(),
  tags: z.array(z.string()),
  seoTitle: z.string(),
  metaDescription: z.string(),
});

/**
 * Saves approved (and possibly hand-edited) copy to the product's Google
 * Sheet row — this is what the Review screen's "Continue" button calls.
 * Nothing here re-generates anything; it's a plain patch via
 * updateProductRow, same as every other write to the sheet.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ productId: string }> }) {
  const { productId } = await params;

  const body = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request body." }, { status: 400 });
  }

  try {
    await updateProductRow(productId, parsed.data);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Couldn't save copy to Google Sheets." },
      { status: 502 }
    );
  }

  return NextResponse.json({ ok: true });
}
