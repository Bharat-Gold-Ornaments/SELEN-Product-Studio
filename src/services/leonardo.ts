import "server-only";
import { requireEnv } from "@/lib/env";
import { readTemplate, renderTemplate } from "@/services/templates";
import { DEFAULT_GENERATION_COUNTS } from "@/lib/constants";
import type { ImageCategory } from "@/types/product";

// ── Config ───────────────────────────────────────────────────────────────

const LEONARDO_API_BASE = "https://cloud.leonardo.ai/api/rest/v1";
// GPT Image 2, FLUX.1 Kontext [pro], and other newer partner models only
// exist on Leonardo's newer v2 generations endpoint — a different base URL,
// request shape, and response shape than the v1 endpoint everything else
// here uses. See createGenerationV2() below.
const LEONARDO_API_BASE_V2 = "https://cloud.leonardo.ai/api/rest/v2";
const GPT_IMAGE_2_MODEL = "gpt-image-2";
const FLUX_KONTEXT_PRO_MODEL = "flux-kontext-pro";
// Any model string in here gets routed to the v2 flow instead of the
// classic v1 one. Set LEONARDO_MODEL_ID to one of these exact strings to
// opt in. Add new v2-only models here as they're integrated.
const V2_MODELS = new Set<string>([GPT_IMAGE_2_MODEL, FLUX_KONTEXT_PRO_MODEL]);
const IMAGE_SIZE = { width: 1024, height: 1024 };
// How strongly image-to-image generations should stick to the uploaded
// reference photo (0 = ignore it, 1 = near-identical). 0.5 is Leonardo's own
// documented example value and a reasonable starting point for jewelry: high
// enough to keep the real piece recognizable, low enough to let the prompt's
// styling (marble, lighting, model, etc.) actually take effect. Tune this
// after looking at real output — image-to-image fidelity for fine jewelry
// detail is inherently imperfect and may need adjusting per model.
// Only applies to v1 models (init_strength is a v1-only field).
const IMAGE_TO_IMAGE_STRENGTH = 0.5;
// v2 models that support image reference guidance (FLUX Kontext, Nano
// Banana, etc.) use a bucketed LOW/MID/HIGH strength instead of a continuous
// 0-1 dial. HIGH biases hardest toward preserving the uploaded reference
// exactly, trading off creative restaging — matches wanting generated
// images to look "exactly like the reference design."
const V2_IMAGE_REFERENCE_STRENGTH = "HIGH";
// v1's init_image_id only ever accepts one image — that's a hard limit of
// the field, not a choice made here. v2 models accept several (FLUX Kontext
// documents up to 4, GPT Image 2 up to 6), so every uploaded original
// (front/side/worn) is sent as a separate reference on v2, each showing the
// model a different angle of the real piece. Capped defensively at the
// lower of the two documented limits in case a future v2 model allows fewer.
const MAX_V2_REFERENCE_IMAGES = 4;
// Leonardo's "Pro Color Photography" preset — biases v2 generations toward
// realistic photography rather than the "Dynamic" style v2 defaults to when
// no style_ids are sent, which tends to look more illustrated/stylized than
// true product photography. Not sent for GPT Image 2, which doesn't
// document a style_ids parameter at all.
const PHOTOREAL_STYLE_ID = "7c3f932b-a572-47cb-9b9b-f20211e63b5b";
// Templates keep an optional "--- NEGATIVE PROMPT ---" section (any number
// of dashes, case-insensitive) so the Template Manager can edit negative
// prompts as plain text too, without the templating engine needing to know
// anything about Leonardo's request shape.
const NEGATIVE_PROMPT_DELIMITER = /-{2,}\s*NEGATIVE PROMPT\s*-{2,}/i;
const POLL_INTERVAL_MS = 3000;
// Kept conservative because this whole flow runs inside a single request
// (create job, then poll until done) and Vercel serverless functions have
// a hard execution-time ceiling — 10s on Hobby, up to 300s on Pro with
// `export const maxDuration` set on the calling route. Any route handler
// that calls generateHero/Lifestyle/Closeup (or generateAllImages)
// needs `export const maxDuration = 90;` (or higher, matching this value,
// on a plan that allows it) or Leonardo jobs that run long will get cut off
// mid-poll. If generations routinely take longer than this in practice,
// the fix is to switch to client-side polling against a status endpoint
// instead of blocking the server for the whole job — not to keep raising
// this number.
const POLL_TIMEOUT_MS = 90_000;

// NOTE: field names below (sdGenerationJob.generationId,
// generations_by_pk.status/.generated_images[].url) match Leonardo's
// documented async generation flow as of this writing. Leonardo's API has
// changed shape before — worth a quick diff against
// https://docs.leonardo.ai/reference the first time this runs against a
// real API key, before trusting it unattended.

interface LeonardoCreateGenerationResponse {
  sdGenerationJob?: { generationId?: string };
}

interface LeonardoGetGenerationResponse {
  generations_by_pk?: {
    status?: "PENDING" | "COMPLETE" | "FAILED" | string;
    generated_images?: { url?: string }[];
  };
}

interface LeonardoInitImageResponse {
  uploadInitImage?: { id?: string; url?: string; fields?: string };
}

// v2's response envelope is flat — confirmed against Leonardo's published
// OpenAPI spec (docs.leonardo.ai/reference/creategeneration-1) — unlike v1's
// nested `sdGenerationJob.generationId`.
interface LeonardoV2CreateGenerationResponse {
  generationId?: string;
  apiCreditCost?: number;
}

async function leonardoFetch<T>(path: string, init?: RequestInit, base: string = LEONARDO_API_BASE): Promise<T> {
  const apiKey = requireEnv("LEONARDO_API_KEY");
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(init?.headers ?? {}),
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Leonardo API error ${res.status}: ${body || res.statusText}`);
  }

  return (await res.json()) as T;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** A reference photo the caller wants Leonardo to use for image-to-image generation. */
export interface ReferenceImage {
  buffer: Buffer;
  mimeType: string;
}

/**
 * Uploads a reference photo to Leonardo following its documented
 * presigned-S3 flow (POST /init-image to get an upload target, then a
 * multipart POST straight to S3 with the returned fields). Returns the
 * `id` to pass as `init_image_id` on a subsequent /generations call.
 * Source: https://docs.leonardo.ai/docs/how-to-upload-an-image-using-a-presigned-url
 * — the presigned URL expires in 2 minutes, so this should be called
 * immediately before the generation it's for, not cached.
 */
async function uploadReferenceImage(image: ReferenceImage): Promise<string> {
  const extension = (image.mimeType.split("/")[1] || "jpeg").replace("jpeg", "jpg");

  const presign = await leonardoFetch<LeonardoInitImageResponse>("/init-image", {
    method: "POST",
    body: JSON.stringify({ extension }),
  });

  const { id, url, fields: fieldsJson } = presign.uploadInitImage ?? {};
  if (!id || !url || !fieldsJson) {
    throw new Error("Leonardo did not return an init-image upload target.");
  }

  const fields = JSON.parse(fieldsJson) as Record<string, string>;
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    form.append(key, value);
  }
  // `image.buffer` is a Node Buffer, typed as Uint8Array<ArrayBufferLike> —
  // Blob's DOM typing wants a plain Uint8Array<ArrayBuffer> specifically
  // (ArrayBufferLike also covers SharedArrayBuffer, which Blob rejects at
  // the type level even though the runtime bytes are fine either way).
  // Uint8Array.from() always allocates a fresh, non-shared ArrayBuffer, so
  // it satisfies the type without any unsafe cast.
  const fileBytes = Uint8Array.from(image.buffer);
  form.append("file", new Blob([fileBytes], { type: image.mimeType }), `reference.${extension}`);

  const uploadRes = await fetch(url, { method: "POST", body: form });
  if (!uploadRes.ok) {
    const body = await uploadRes.text().catch(() => "");
    throw new Error(`Leonardo reference photo upload failed ${uploadRes.status}: ${body || uploadRes.statusText}`);
  }

  return id;
}

interface CreateGenerationParams {
  prompt: string;
  negativePrompt?: string;
  numImages: number;
  // Every uploaded original (front/side/worn) that has a reference image id,
  // most-preferred first. v1 can only use one (init_image_id has no array
  // form) so it takes initImageIds[0]; v2 models use as many as they
  // support, up to MAX_V2_REFERENCE_IMAGES.
  initImageIds?: string[];
}

async function createGeneration(params: CreateGenerationParams): Promise<string> {
  const modelId = process.env.LEONARDO_MODEL_ID;

  // GPT Image 2, FLUX Kontext, etc. don't exist on the v1 endpoint at all —
  // route to the v2 request/response shape entirely. Set LEONARDO_MODEL_ID
  // to one of the exact strings in V2_MODELS to opt in; leave it unset (or
  // a v1 model UUID) to keep using the v1 flow below, which is what every
  // classic model uses.
  if (modelId && V2_MODELS.has(modelId)) {
    return createGenerationV2(modelId, params);
  }

  const initImageId = params.initImageIds?.[0];

  const body = await leonardoFetch<LeonardoCreateGenerationResponse>("/generations", {
    method: "POST",
    body: JSON.stringify({
      prompt: params.prompt,
      num_images: params.numImages,
      width: IMAGE_SIZE.width,
      height: IMAGE_SIZE.height,
      // Biases toward realistic photography over Leonardo's default
      // stylization — alchemy (on by default) accepts this value.
      presetStyle: "PHOTOGRAPHY",
      ...(params.negativePrompt ? { negative_prompt: params.negativePrompt } : {}),
      // Image-to-image: only sent when a reference photo was uploaded. v1
      // only supports a single init image — see the note on
      // CreateGenerationParams.initImageIds above.
      // See https://docs.leonardo.ai/docs/generate-images-using-image-to-image-guidance
      ...(initImageId ? { init_image_id: initImageId, init_strength: IMAGE_TO_IMAGE_STRENGTH } : {}),
      ...(modelId ? { modelId } : {}),
    }),
  });

  const generationId = body.sdGenerationJob?.generationId;
  if (!generationId) {
    throw new Error("Leonardo did not return a generation id.");
  }
  return generationId;
}

/**
 * Shared request builder for every model in V2_MODELS. These live on
 * Leonardo's v2 generations endpoint (https://cloud.leonardo.ai/api/rest/v2/generations),
 * which has a completely different request shape from v1: `{ model,
 * parameters: {...} }` instead of flat top-level fields, and no
 * `modelId`/`negative_prompt` fields at all. Confirmed against Leonardo's
 * guides (docs.leonardo.ai/docs/gpt-image-2, docs.leonardo.ai/docs/flux-1-kontext-pro)
 * and published OpenAPI spec (docs.leonardo.ai/reference/creategeneration-1).
 *
 * Real feature losses versus the v1 models, inherent to these models on
 * Leonardo's platform, not a gap in this integration:
 *  - No negative prompt support on any v2 model seen so far —
 *    `params.negativePrompt` is silently dropped here.
 *  - Reference-photo influence is a bucketed LOW/MID/HIGH strength
 *    (V2_IMAGE_REFERENCE_STRENGTH) rather than v1's continuous 0-1
 *    `init_strength` dial. GPT Image 2 goes a step further and ignores
 *    strength entirely — the model decides on its own.
 *
 * Unlike v1, these models accept multiple reference images in one request
 * (`guidances.image_reference` is an array) — every uploaded original
 * (front/side/worn) is sent, not just one, so the model sees the piece from
 * every angle that was actually photographed. Each still goes through the
 * same uploadReferenceImage() v1 /init-image flow — the returned image id
 * is a platform-wide id, not a v1-specific one, and both models' own guides
 * show exactly this pattern (an "UPLOADED" image id passed into
 * `guidances.image_reference`).
 */
async function createGenerationV2(model: string, params: CreateGenerationParams): Promise<string> {
  const imageIds = (params.initImageIds ?? []).slice(0, MAX_V2_REFERENCE_IMAGES);
  const referenceGuidance =
    imageIds.length > 0
      ? imageIds.map((id) =>
          // GPT Image 2 explicitly doesn't accept a `strength` field on its
          // image references — see the comment above.
          model === GPT_IMAGE_2_MODEL
            ? { image: { id, type: "UPLOADED" } }
            : { image: { id, type: "UPLOADED" }, strength: V2_IMAGE_REFERENCE_STRENGTH }
        )
      : undefined;

  const body = await leonardoFetch<Record<string, unknown>>(
    "/generations",
    {
      method: "POST",
      body: JSON.stringify({
        public: false,
        model,
        parameters: {
          prompt: params.prompt,
          quantity: params.numImages,
          width: IMAGE_SIZE.width,
          height: IMAGE_SIZE.height,
          prompt_enhance: "OFF",
          ...(model === GPT_IMAGE_2_MODEL ? { quality: "MEDIUM" } : { style_ids: [PHOTOREAL_STYLE_ID] }),
          ...(referenceGuidance ? { guidances: { image_reference: referenceGuidance } } : {}),
        },
      }),
    },
    LEONARDO_API_BASE_V2
  );

  // Confirmed against a real GPT Image 2 call — the published OpenAPI spec
  // (flat `generationId`) is wrong for this endpoint in practice; the
  // actual response nests everything under a `generate` key, e.g.:
  //   { "generate": { "generationId": "...", "cost": { "amount": "0.0972", "unit": "DOLLARS" } } }
  // Assumed to hold for every v2 model since they share this one endpoint,
  // but only verified for GPT Image 2 so far — the fallback checks below
  // exist in case FLUX Kontext (or a future model) turns out to differ.
  const nested = body.generate as { generationId?: string; cost?: { amount?: string; unit?: string } } | undefined;
  const generationId =
    (typeof nested?.generationId === "string" && nested.generationId) ||
    (typeof body.generationId === "string" && body.generationId) ||
    (typeof body.id === "string" && body.id) ||
    (typeof (body as { sdGenerationJob?: { generationId?: string } }).sdGenerationJob?.generationId === "string" &&
      (body as { sdGenerationJob?: { generationId?: string } }).sdGenerationJob?.generationId) ||
    undefined;

  if (!generationId) {
    console.error(`Leonardo ${model} /generations response (no generation id found):`, JSON.stringify(body));
    throw new Error(
      `Leonardo (${model}) did not return a generation id. Raw response: ${JSON.stringify(body).slice(0, 500)}`
    );
  }

  if (nested?.cost?.amount) {
    console.info(`Leonardo ${model} generation cost: $${nested.cost.amount} ${nested.cost.unit ?? ""}`.trim());
  }

  return generationId;
}

// Deliberately still hits the v1 "Get a Single Generation" endpoint even
// for jobs created via v2 (GPT Image 2, FLUX Kontext, ...) — Leonardo
// documents this as the canonical way to check status for any generation
// regardless of which creation endpoint made it, and generationId is a
// platform-wide id, not a v1-specific one. Confirmed working for GPT Image
// 2 against a real key; unconfirmed for FLUX Kontext specifically — if
// status checks start failing just for flux-kontext-pro jobs, this is the
// first place to look, and the fix would be adding a v2-specific status
// endpoint here.
async function pollGeneration(generationId: string): Promise<string[]> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const body = await leonardoFetch<LeonardoGetGenerationResponse>(`/generations/${generationId}`);
    const status = body.generations_by_pk?.status;

    if (status === "COMPLETE") {
      const urls = (body.generations_by_pk?.generated_images ?? [])
        .map((image) => image.url)
        .filter((url): url is string => Boolean(url));
      if (urls.length === 0) {
        throw new Error("Leonardo reported the generation as complete but returned no images.");
      }
      return urls;
    }

    if (status === "FAILED") {
      throw new Error("Leonardo reported the generation as failed.");
    }

    await delay(POLL_INTERVAL_MS);
  }

  throw new Error("Timed out waiting for Leonardo to finish generating images.");
}

async function generateImages(params: CreateGenerationParams): Promise<string[]> {
  const generationId = await createGeneration(params);
  return pollGeneration(generationId);
}

// ── Template-driven category generators ─────────────────────────────────

/**
 * Flat variable set injected into the Hero/Lifestyle/Closeup
 * templates. Building this from a specific product's form values is the
 * caller's job (keeps this service agnostic of the product type schema);
 * `dimensions` and `collections` are expected pre-formatted as display
 * strings (e.g. "3.2cm x 2.1cm", "Bestsellers, New Arrivals").
 */
export interface ImagePromptVariables {
  productType: string;
  finish: string;
  stone: string;
  dimensions: string;
  collections: string;
}

// Shown to the model when at least one reference photo is available, filled
// into the template's {{referenceNote}} placeholder. Left as an empty
// string when there are none (all photos are optional — see
// product-schemas.ts), so the prompt still reads naturally as pure
// text-to-image in that case. Worded to make sense whether one photo or
// several were uploaded. Kept short on purpose — Leonardo caps prompts at
// 1500 characters total, and this gets added on top of whatever the
// template itself already uses.
const REFERENCE_NOTE =
  "Use the uploaded reference photos as the exact product reference — keep the design, proportions, gemstones, and finish unchanged.";

// Leonardo rejects prompts (and, empirically, treats negative prompts the
// same way) over 1500 characters with a 400. Templates are edited as free
// text in the Template Manager, so there's no guarantee an edit — especially
// with {{referenceNote}} expanding to more characters than its own
// placeholder — stays under that after substitution. Truncating here is a
// last-resort safety net, not the primary defense; the shipped templates are
// written to leave comfortable headroom on their own.
async function generateForCategory(
  category: ImageCategory,
  variables: ImagePromptVariables,
  numImages: number,
  referenceImages?: ReferenceImage[]
): Promise<string[]> {
  const template = await readTemplate(category);
  const [positiveRaw, negativeRaw] = template.content.split(NEGATIVE_PROMPT_DELIMITER);

  const hasReference = Boolean(referenceImages && referenceImages.length > 0);
  const renderVars = { ...variables, referenceNote: hasReference ? REFERENCE_NOTE : "" };
  const prompt = renderTemplate(positiveRaw.trim(), renderVars);
  const negativePrompt = negativeRaw?.trim() ? renderTemplate(negativeRaw.trim(), renderVars) : undefined;

  // The presigned upload URL expires in 2 minutes, so upload right before
  // generating rather than once up front. Every reference photo is
  // uploaded — not just the first — so v2 models can use all of them.
  const initImageIds = hasReference
    ? await Promise.all(referenceImages!.map((image) => uploadReferenceImage(image)))
    : undefined;

  return generateImages({ prompt, negativePrompt, numImages, initImageIds });
}

export async function generateHero(
  variables: ImagePromptVariables,
  referenceImages?: ReferenceImage[]
): Promise<string[]> {
  return generateForCategory("hero", variables, DEFAULT_GENERATION_COUNTS.hero, referenceImages);
}

export async function generateLifestyle(
  variables: ImagePromptVariables,
  referenceImages?: ReferenceImage[]
): Promise<string[]> {
  return generateForCategory("lifestyle", variables, DEFAULT_GENERATION_COUNTS.lifestyle, referenceImages);
}

export async function generateCloseup(
  variables: ImagePromptVariables,
  referenceImages?: ReferenceImage[]
): Promise<string[]> {
  return generateForCategory("closeup", variables, DEFAULT_GENERATION_COUNTS.closeup, referenceImages);
}

// ── Orchestration ────────────────────────────────────────────────────────

export type CategoryGenerationResult =
  | { category: ImageCategory; status: "success"; imageUrls: string[] }
  | { category: ImageCategory; status: "error"; message: string };

const GENERATORS: Record<
  ImageCategory,
  (variables: ImagePromptVariables, referenceImages?: ReferenceImage[]) => Promise<string[]>
> = {
  hero: generateHero,
  lifestyle: generateLifestyle,
  closeup: generateCloseup,
};

/**
 * Runs the requested categories independently via `Promise.allSettled` —
 * per spec, a failure in one category (e.g. Hero) must never prevent the
 * others from completing. The Review screen (Milestone 6) calls this once
 * and gets back a per-category success/error result to render, instead of
 * the whole product generation failing outright.
 *
 * `referenceImages`, when provided, are used as an image-to-image reference
 * for every requested category (uploaded to Leonardo separately per
 * category, since each is an independent generation job) — see
 * product-generation.ts for how the reference photos are chosen from the
 * uploaded originals.
 *
 * `categories`, when provided, generates only that subset (letting Create
 * Product let the user pick which of Hero/Lifestyle/Closeup to generate);
 * defaults to all three when omitted.
 */
export async function generateAllImages(
  variables: ImagePromptVariables,
  referenceImages?: ReferenceImage[],
  categories?: ImageCategory[]
): Promise<CategoryGenerationResult[]> {
  const requested =
    categories && categories.length > 0 ? categories : (Object.keys(GENERATORS) as ImageCategory[]);
  const settled = await Promise.allSettled(
    requested.map((category) => GENERATORS[category](variables, referenceImages))
  );

  return settled.map((result, index) => {
    const category = requested[index];
    if (result.status === "fulfilled") {
      return { category, status: "success", imageUrls: result.value };
    }
    return {
      category,
      status: "error",
      message: result.reason instanceof Error ? result.reason.message : "Image generation failed.",
    };
  });
}

/**
 * Regenerates a single category on its own — this is what the Review
 * screen's per-section "Regenerate" button calls. Regenerating Hero, for
 * example, never touches Lifestyle/Closeup.
 */
export async function generateCategoryImages(
  category: ImageCategory,
  variables: ImagePromptVariables,
  referenceImages?: ReferenceImage[]
): Promise<string[]> {
  return GENERATORS[category](variables, referenceImages);
}
