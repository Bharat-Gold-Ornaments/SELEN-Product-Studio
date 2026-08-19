import { NextResponse } from "next/server";
import { z } from "zod";
import {
  generateAllCopy,
  generateCopyField,
  type CopyFieldResult,
  type CopyGenerationContext,
  type SeoCopy,
  type VisionImage,
} from "@/services/anthropic-copy";
import { updateProductRow } from "@/services/google-sheets";
import { downloadFile, driveFileIdFromImageProxyUrl } from "@/services/google-drive";
import { listCollections } from "@/services/shopify";
import type { ImagePromptVariables } from "@/lib/generation-variables";
import type { ProductRecord } from "@/types/product";

export const maxDuration = 60;

const variablesSchema = z.object({
  productType: z.string(),
  finish: z.string(),
  stone: z.string(),
  dimensions: z.string(),
  collections: z.string(),
});

const postSchema = z.object({
  field: z.enum(["all", "title", "description", "tags", "seo", "collections"]),
  variables: variablesSchema,
  // Current title (approved or edited on screen) — required for every
  // field except "title"/"collections", since description/tags/SEO all
  // reference it. See generateCopyField's doc comment in
  // services/anthropic-copy.ts.
  title: z.string().optional(),
  // `/api/drive-image/{fileId}` proxy URLs of whichever hero/lifestyle
  // image currently exists for this product (Review generates images
  // before copy, so these are usually available) — used for vision-based
  // title/description and collection classification. Optional since copy
  // can still be generated before any image is picked.
  heroImageUrl: z.string().optional(),
  lifestyleImageUrl: z.string().optional(),
});

const ALLOWED_MEDIA_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

// Downloads a picked image's real bytes from Drive (never trusts a public
// URL — same reasoning as publish/route.ts) and base64-encodes it for the
// Anthropic SDK's ImageBlockParam, which only accepts base64 data in this
// SDK version. Returns undefined rather than throwing on any failure (wrong
// mimeType, missing file, proxy URL not yet pointing at a real Drive file)
// since copy generation should still work without a photo attached — vision
// is a quality improvement here, not a hard requirement.
async function loadVisionImage(proxyUrl: string | undefined): Promise<VisionImage | undefined> {
  if (!proxyUrl) return undefined;
  try {
    const fileId = driveFileIdFromImageProxyUrl(proxyUrl);
    const { buffer, mimeType } = await downloadFile(fileId);
    if (!ALLOWED_MEDIA_TYPES.has(mimeType)) return undefined;
    return { data: buffer.toString("base64"), mediaType: mimeType as VisionImage["mediaType"] };
  } catch {
    return undefined;
  }
}

/**
 * Generates product copy for the Review screen. `field: "all"` runs the
 * full title -> description/tags/seo/collections chain
 * (services/anthropic-copy.ts); any other field regenerates just that one,
 * reusing whatever title is currently on screen. Never writes to Google
 * Sheets — that only happens once the user approves the copy and hits
 * Continue (see the PATCH handler below).
 */
// Not scoped to :productId at all — generating copy doesn't touch Google
// Sheets, it only needs the variables the caller already has on screen (and
// whichever image proxy URLs Review currently has selected). Saving (which
// is per-product) happens in PATCH below.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const { field, variables, title, heroImageUrl, lifestyleImageUrl } = parsed.data;

  const [heroImage, lifestyleImage, availableCollections] = await Promise.all([
    loadVisionImage(heroImageUrl),
    loadVisionImage(lifestyleImageUrl),
    listCollections()
      .then((collections) => collections.map((c) => c.title))
      .catch(() => []),
  ]);
  const context: CopyGenerationContext = { heroImage, lifestyleImage, availableCollections };

  if (field === "all") {
    const result = await generateAllCopy(variables as ImagePromptVariables, context);
    return NextResponse.json({ result });
  }

  const result: CopyFieldResult<string | string[] | SeoCopy> = await generateCopyField(
    field,
    variables as ImagePromptVariables,
    title,
    context
  );
  return NextResponse.json({ field, result });
}

const patchSchema = z.object({
  title: z.string().min(1, "Title can't be empty."),
  description: z.string(),
  tags: z.array(z.string()),
  seoTitle: z.string(),
  metaDescription: z.string(),
  // Also accepted (and optional) here rather than as a separate endpoint:
  // Review's "Continue" is the one moment the user has approved both the
  // copy AND which image wins each category, so both get persisted in the
  // same single-row write instead of two round trips. These are the
  // `/api/drive-image/{fileId}` proxy URLs from the selected
  // CategoryGenerationResult, not raw Drive file ids — see
  // services/google-drive.ts's imageProxyUrl. Left out entirely (rather
  // than sent as "") if a category wasn't selected yet, so an
  // already-saved pick never gets clobbered with a blank by a later,
  // unrelated copy-only save.
  heroImageLink: z.string().optional(),
  lifestyleImageLink: z.string().optional(),
  closeupImageLink: z.string().optional(),
  // AI-classified (or hand-edited) collections from Review's vision-based
  // classification — optional and left out entirely when absent, same
  // reasoning as the image links below, so a product saved before
  // collections existed doesn't get clobbered with an empty list.
  collections: z.array(z.string()).optional(),
});

/**
 * Saves approved (and possibly hand-edited) copy — and, whichever image was
 * picked per category — to the product's Google Sheet row. This is what the
 * Review screen's "Continue" button calls. Nothing here re-generates
 * anything; it's a plain patch via updateProductRow, same as every other
 * write to the sheet.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ productId: string }> }) {
  const { productId } = await params;

  const body = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request body." }, { status: 400 });
  }

  // Built explicitly rather than passing parsed.data straight through —
  // zod's output can carry an `undefined`-valued key for an omitted
  // optional field, and spreading that into updateProductRow's merge would
  // overwrite an already-saved image link with undefined. Only include a
  // link when the request actually sent one.
  const {
    title,
    description,
    tags,
    seoTitle,
    metaDescription,
    heroImageLink,
    lifestyleImageLink,
    closeupImageLink,
    collections,
  } = parsed.data;
  const patch: Partial<ProductRecord> = { title, description, tags, seoTitle, metaDescription };
  if (heroImageLink !== undefined) patch.heroImageLink = heroImageLink;
  if (lifestyleImageLink !== undefined) patch.lifestyleImageLink = lifestyleImageLink;
  if (closeupImageLink !== undefined) patch.closeupImageLink = closeupImageLink;
  if (collections !== undefined) patch.collections = collections;

  try {
    await updateProductRow(productId, patch);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Couldn't save copy to Google Sheets." },
      { status: 502 }
    );
  }

  return NextResponse.json({ ok: true });
}
