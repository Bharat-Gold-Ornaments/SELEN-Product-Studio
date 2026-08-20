import "server-only";
import { requireEnv } from "@/lib/env";
import { readTemplate, renderTemplate } from "@/services/templates";
import { readAppSettings } from "@/services/app-settings";
import { imageTemplateId } from "@/lib/template-categories";
import { traceGeneration, imageDataUri, startActiveObservation } from "@/services/observability";
import type { ImageCategory, ProductType } from "@/types/product";

// ── Config ───────────────────────────────────────────────────────────────

const LEONARDO_API_BASE = "https://cloud.leonardo.ai/api/rest/v1";
// GPT Image 2, FLUX.1 Kontext [pro], and other newer partner models only
// exist on Leonardo's newer v2 generations endpoint — a different base URL,
// request shape, and response shape than the v1 endpoint everything else
// here uses. See createGenerationV2() below.
const LEONARDO_API_BASE_V2 = "https://cloud.leonardo.ai/api/rest/v2";
const GPT_IMAGE_2_MODEL = "gpt-image-2";
const FLUX_KONTEXT_PRO_MODEL = "flux-kontext-pro";
// Leonardo's own native model (despite also living on the v2 endpoint,
// unlike GPT Image 2/FLUX Kontext this isn't a third-party partner model).
// Confirmed against https://docs.leonardo.ai/docs/phoenix.
const PHOENIX_MODEL = "phoenix-v1.0";
// "Nano Banana Pro" (Gemini 3 Pro Image) — a third-party partner model like
// GPT Image 2/FLUX Kontext. Confirmed against
// https://docs.leonardo.ai/docs/nano-banana-pro.
const NANO_BANANA_PRO_MODEL = "gemini-image-2";
// A third-party partner model like the two above — no relation to the v1
// "IMAGE_TO_IMAGE_STRENGTH"-style dial. IMPORTANT: unlike every other v2
// model here, Ideogram 3.0 has NO image-to-image / reference-image support
// at all on Leonardo's API — no `guidances` field of any kind is documented
// for it (confirmed by an exhaustive search of its docs page for
// "guidances", "image_reference", "image_to_image", "reference image", and
// "init_image" — none appear). Selecting this model means every generation,
// including Regenerate, runs as pure text-to-image: uploaded front/side/worn
// photos are silently NOT used to keep the result visually consistent with
// the real piece, unlike every other model this app supports. Confirmed
// against https://docs.leonardo.ai/docs/ideogram-30.
const IDEOGRAM_3_MODEL = "ideogram-v3.0";
// Any model string in here gets routed to the v2 flow instead of the
// classic v1 one. Set LEONARDO_MODEL_ID to one of these exact strings to
// opt in. Add new v2-only models here as they're integrated — see
// V2_MODEL_CONFIGS below for what else a new model needs.
const V2_MODELS = new Set<string>([
  GPT_IMAGE_2_MODEL,
  FLUX_KONTEXT_PRO_MODEL,
  PHOENIX_MODEL,
  NANO_BANANA_PRO_MODEL,
  IDEOGRAM_3_MODEL,
]);
const IMAGE_SIZE = { width: 1024, height: 1024 };
// How strongly image-to-image generations should stick to the uploaded
// reference photo (0 = ignore it, 1 = near-identical). Set high (not 1.0
// flat out, since Leonardo's own guidance treats the extreme top of the
// range as prone to artifacting) to keep generated jewelry as faithful as
// possible to the real uploaded piece — accuracy to the actual product
// matters more here than letting the prompt's styling take liberties.
// Only applies to v1 models (init_strength is a v1-only field).
const IMAGE_TO_IMAGE_STRENGTH = 0.9;
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
// true product photography. Only confirmed valid for FLUX Kontext — style_ids
// catalogs are scoped per model on Leonardo's platform (an unrecognized style
// id produces a generic, field-less "VALIDATION_ERROR" — confirmed the hard
// way trying to reuse this for Phoenix), so don't reach for this for a new
// model without checking its own docs page for a confirmed style id first.
const PHOTOREAL_STYLE_ID = "7c3f932b-a572-47cb-9b9b-f20211e63b5b";
// Leonardo's "Dynamic" style — confirmed (via each model's own docs example
// request/style table) as a valid style id for Phoenix, Nano Banana Pro, and
// Ideogram 3.0. Less strictly "photoreal" than PHOTOREAL_STYLE_ID, but actually verified for
// these models, which PHOTOREAL_STYLE_ID isn't.
const LEONARDO_DYNAMIC_STYLE_ID = "111dc692-d470-4eec-b791-3475abac4c46";
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
// needs `export const maxDuration = 180;` (or higher, matching this value,
// on a plan that allows it) or Leonardo jobs that run long will get cut off
// mid-poll. If generations routinely take longer than this in practice,
// the fix is to switch to client-side polling against a status endpoint
// instead of blocking the server for the whole job — not to keep raising
// this number.
const POLL_TIMEOUT_MS = 180_000;

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
    generated_images?: { url?: string; nsfw?: boolean }[];
    // Present when Leonardo's (or the underlying partner model's, e.g. GPT
    // Image 2's) content moderation flagged the prompt — this is the actual
    // reason behind most "FAILED" generations and behind images that come
    // back COMPLETE with generated_images[].nsfw: true. Confirmed against a
    // real gpt-image-2 call: see the comment on pollGeneration below.
    prompt_moderations?: { moderationClassification?: string[] }[];
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

/**
 * Cheapest possible real proof the API key works — Leonardo's "get current
 * user" endpoint, not a generation. Used by Settings' Integration Status
 * panel (api/settings/status/route.ts); throws leonardoFetch's real error
 * message (bad key, expired key, network issue, etc.) straight through,
 * which is exactly what a diagnostics panel wants instead of a generic
 * pass/fail.
 */
export async function checkLeonardoConnection(): Promise<void> {
  await leonardoFetch("/me");
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

// Body/person-related negative-prompt clauses get stripped before folding
// into a v2 model's prompt text as `avoid: "..."` (see createGenerationV2
// below). GPT Image 2's own content moderation scans that text the same as
// any other prompt content and, empirically, doesn't parse "avoid"/"no X" as
// safe negation — a clause that names hands, a model, a face, ears, etc.
// purely to *exclude* them still reads as human/body-related content and
// gets the whole generation flagged. Confirmed against this app's own
// earrings Hero/Lifestyle/Closeup templates, which all started failing with
// NSFW/moderation errors the moment LEONARDO_MODEL_ID was set to
// "gpt-image-2" — the same templates work fine on v1, whose dedicated
// negative_prompt field isn't moderated this way. Every other kind of
// exclusion (altered gemstones, CGI, low detail, cluttered background, etc.)
// is unaffected and stays in; only clauses hitting one of these whole-word
// terms get dropped. Word-boundary matching so "earring(s)" — the actual
// product — is never caught by the "ear" term.
const V2_RISKY_NEGATIVE_TERMS = [
  "hand",
  "hands",
  "model",
  "face",
  "body",
  "ear",
  "ears",
  "hair",
  "skin",
  "person",
  "human",
];
const V2_RISKY_TERM_PATTERN = new RegExp(`\\b(${V2_RISKY_NEGATIVE_TERMS.join("|")})\\b`, "i");

function sanitizeNegativePromptForV2(negativePrompt: string): string | undefined {
  const safeClauses = negativePrompt
    .split(/[,.\n]+/)
    .map((clause) => clause.trim())
    .filter((clause) => clause.length > 0 && !V2_RISKY_TERM_PATTERN.test(clause));
  return safeClauses.length > 0 ? safeClauses.join(", ") : undefined;
}

/**
 * Everything about a v2 model's request shape that differs from the others —
 * see V2_MODEL_CONFIGS below for the actual per-model values, each sourced
 * from that model's own Leonardo docs page. Adding a new v2 model means:
 * add its model-id constant, add it to V2_MODELS, add a config row here
 * (checking its own docs page for each of these fields — do NOT assume it
 * matches an existing model, see PHOTOREAL_STYLE_ID's doc comment for why
 * that assumption already broke once), and that's it — createGenerationV2
 * itself never needs to change again for a model that fits this shape.
 */
interface V2ModelConfig {
  /**
   * "field": has a real `negative_prompt` request field (Phoenix). Used
   * directly, no moderation-risk sanitization needed — same as v1.
   * "prompt-injection": no such field exists (every third-party partner
   * model seen so far), so negative-prompt intent gets folded into the end
   * of the main prompt as `avoid: "..."` instead — the only way to get it
   * in front of the model at all. Run through sanitizeNegativePromptForV2
   * first: that text is scanned by the model's own moderation like any
   * other prompt content, and a clause naming a body part purely to
   * *exclude* it (e.g. "no hands") still reads as human/body-related
   * content there — confirmed causing real NSFW-classification failures
   * with this app's own templates once GPT Image 2 was in use.
   */
  negativePrompt: "field" | "prompt-injection";
  /** Field name under `guidances` that reference images go under — not the same for every model (Phoenix uses `image_to_image`, everything else `image_reference`). */
  referenceGuidanceKey: "image_reference" | "image_to_image";
  /** Max reference images this model accepts in one request, per its own docs — capped further by however many of front/side/worn were actually uploaded. 0 means the model has no image-to-image support at all (Ideogram 3.0): the generation still runs, but purely as text-to-image. */
  maxReferenceImages: number;
  /** Whether each guidances.* image item includes a `strength` field — GPT Image 2 explicitly rejects one and decides strength on its own. */
  referenceStrength: boolean;
  /** Extra fixed `parameters` fields this model needs (style_ids, quality, etc.), verified against that model's own docs — merged in as-is. */
  extraParameters?: Record<string, unknown>;
}

const V2_MODEL_CONFIGS: Record<string, V2ModelConfig> = {
  // docs.leonardo.ai/docs/gpt-image-2
  [GPT_IMAGE_2_MODEL]: {
    negativePrompt: "prompt-injection",
    referenceGuidanceKey: "image_reference",
    maxReferenceImages: MAX_V2_REFERENCE_IMAGES,
    referenceStrength: false,
    extraParameters: { quality: "MEDIUM" },
  },
  // docs.leonardo.ai/docs/flux-1-kontext-pro
  [FLUX_KONTEXT_PRO_MODEL]: {
    negativePrompt: "prompt-injection",
    referenceGuidanceKey: "image_reference",
    maxReferenceImages: MAX_V2_REFERENCE_IMAGES,
    referenceStrength: true,
    extraParameters: { style_ids: [PHOTOREAL_STYLE_ID] },
  },
  // docs.leonardo.ai/docs/phoenix
  [PHOENIX_MODEL]: {
    negativePrompt: "field",
    referenceGuidanceKey: "image_to_image",
    maxReferenceImages: 1,
    referenceStrength: true,
    // No style_ids: PHOTOREAL_STYLE_ID isn't confirmed for Phoenix's own
    // catalog (this exact assumption caused a real VALIDATION_ERROR) —
    // omitted so it falls back to Phoenix's own documented default
    // (LEONARDO_DYNAMIC_STYLE_ID) instead of risking another wrong id.
  },
  // docs.leonardo.ai/docs/nano-banana-pro — no negative_prompt field, no
  // quality/mode field, style_ids present but with no confirmed default of
  // its own; LEONARDO_DYNAMIC_STYLE_ID is what Leonardo's own example
  // request for this exact model uses.
  [NANO_BANANA_PRO_MODEL]: {
    negativePrompt: "prompt-injection",
    referenceGuidanceKey: "image_reference",
    maxReferenceImages: 6,
    referenceStrength: true,
    extraParameters: { style_ids: [LEONARDO_DYNAMIC_STYLE_ID] },
  },
  // docs.leonardo.ai/docs/ideogram-30 — no negative_prompt field, no
  // image-to-image support of any kind (see IDEOGRAM_3_MODEL's doc comment
  // above), so referenceGuidanceKey/referenceStrength below are never
  // actually used (maxReferenceImages: 0 means initImageIds always gets
  // sliced down to empty before either matters). `quality: "QUALITY"` is
  // this model's highest-photorealism tier (TURBO/BALANCED/QUALITY) — its
  // own example request actually uses "MEDIUM", which isn't one of its
  // three documented enum values; QUALITY is used here instead since photo-
  // realism was explicitly asked for. style_ids uses the same
  // LEONARDO_DYNAMIC_STYLE_ID confirmed via this model's own style table.
  [IDEOGRAM_3_MODEL]: {
    negativePrompt: "prompt-injection",
    referenceGuidanceKey: "image_reference",
    maxReferenceImages: 0,
    referenceStrength: false,
    extraParameters: { quality: "QUALITY", style_ids: [LEONARDO_DYNAMIC_STYLE_ID] },
  },
};

/**
 * Shared request builder for every model in V2_MODELS, driven by
 * V2_MODEL_CONFIGS above. These live on Leonardo's v2 generations endpoint
 * (https://cloud.leonardo.ai/api/rest/v2/generations), which has a
 * completely different request shape from v1: `{ model, parameters: {...} }`
 * instead of flat top-level fields, and no `modelId` field.
 *
 * Every uploaded original (front/side/worn) is sent as a separate reference
 * image, up to whatever the model's own config.maxReferenceImages allows —
 * each one goes through the same uploadReferenceImage() v1 /init-image flow
 * regardless of which v2 model ends up using it; the returned image id is a
 * platform-wide id, not a v1-specific one.
 */
async function createGenerationV2(model: string, params: CreateGenerationParams): Promise<string> {
  const config = V2_MODEL_CONFIGS[model];
  if (!config) {
    throw new Error(
      `Leonardo v2 model "${model}" has no request config — add one to V2_MODEL_CONFIGS in services/leonardo.ts (see that constant's doc comment).`
    );
  }

  const usesRealNegativePrompt = config.negativePrompt === "field";
  const safeNegativePrompt =
    !usesRealNegativePrompt && params.negativePrompt ? sanitizeNegativePromptForV2(params.negativePrompt) : undefined;
  const prompt = safeNegativePrompt ? `${params.prompt}\n\navoid: "${safeNegativePrompt}"` : params.prompt;

  const imageIds = (params.initImageIds ?? []).slice(0, config.maxReferenceImages);
  const referenceGuidance =
    imageIds.length > 0
      ? imageIds.map((id) =>
          config.referenceStrength
            ? { image: { id, type: "UPLOADED" }, strength: V2_IMAGE_REFERENCE_STRENGTH }
            : { image: { id, type: "UPLOADED" } }
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
          prompt,
          quantity: params.numImages,
          width: IMAGE_SIZE.width,
          height: IMAGE_SIZE.height,
          prompt_enhance: "OFF",
          ...config.extraParameters,
          ...(usesRealNegativePrompt && params.negativePrompt ? { negative_prompt: params.negativePrompt } : {}),
          ...(referenceGuidance ? { guidances: { [config.referenceGuidanceKey]: referenceGuidance } } : {}),
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
    const generation = body.generations_by_pk;
    const status = generation?.status;

    // Confirmed against a real gpt-image-2 call while diagnosing this
    // template's "Leonardo reported the generation as failed" errors: this
    // field is present alongside both status: "FAILED" and (more
    // insidiously) status: "COMPLETE" with generated_images[].nsfw: true —
    // Leonardo doesn't always hard-fail a moderation hit, it sometimes just
    // flags the resulting image and returns it anyway. Surfacing this text
    // in both branches below turns a useless generic error into an
    // actionable one, and stops flagged images from silently reaching
    // Shopify as if generation had succeeded cleanly.
    const moderationReasons = (generation?.prompt_moderations ?? [])
      .flatMap((m) => m.moderationClassification ?? [])
      .filter(Boolean);
    const moderationSuffix =
      moderationReasons.length > 0 ? ` (flagged by content moderation: ${moderationReasons.join(", ")})` : "";

    if (status === "COMPLETE") {
      const images = generation?.generated_images ?? [];
      const clean = images.filter((image) => Boolean(image.url) && !image.nsfw);
      if (clean.length === 0) {
        throw new Error(
          images.length > 0
            ? `Leonardo flagged every generated image as NSFW and none were usable${moderationSuffix}. Try regenerating, or soften this category's template if it keeps happening.`
            : "Leonardo reported the generation as complete but returned no images."
        );
      }
      return clean.map((image) => image.url as string);
    }

    if (status === "FAILED") {
      throw new Error(`Leonardo reported the generation as failed${moderationSuffix}.`);
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
  productType: ProductType,
  category: ImageCategory,
  variables: ImagePromptVariables,
  numImages: number,
  referenceImages?: ReferenceImage[],
  productId?: string
): Promise<string[]> {
  const template = await readTemplate(imageTemplateId(productType, category));
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

  return traceGeneration({
    name: `leonardo.${category}`,
    model: process.env.LEONARDO_MODEL_ID || "leonardo-v1-default",
    input: {
      prompt,
      negativePrompt,
      numImages,
      referenceImages: referenceImages?.map((image) => imageDataUri(image.mimeType, image.buffer.toString("base64"))),
    },
    metadata: { productId, productType, category, provider: "leonardo" },
    run: () => generateImages({ prompt, negativePrompt, numImages, initImageIds }),
    toUpdate: (imageUrls) => ({ output: { imageUrls } }),
  });
}

export async function generateHero(
  productType: ProductType,
  variables: ImagePromptVariables,
  referenceImages?: ReferenceImage[],
  productId?: string
): Promise<string[]> {
  const settings = await readAppSettings();
  return generateForCategory(
    productType,
    "hero",
    variables,
    settings.generationCounts.hero,
    referenceImages,
    productId
  );
}

export async function generateLifestyle(
  productType: ProductType,
  variables: ImagePromptVariables,
  referenceImages?: ReferenceImage[],
  productId?: string
): Promise<string[]> {
  const settings = await readAppSettings();
  return generateForCategory(
    productType,
    "lifestyle",
    variables,
    settings.generationCounts.lifestyle,
    referenceImages,
    productId
  );
}

export async function generateCloseup(
  productType: ProductType,
  variables: ImagePromptVariables,
  referenceImages?: ReferenceImage[],
  productId?: string
): Promise<string[]> {
  const settings = await readAppSettings();
  return generateForCategory(
    productType,
    "closeup",
    variables,
    settings.generationCounts.closeup,
    referenceImages,
    productId
  );
}

// ── Orchestration ────────────────────────────────────────────────────────

export type CategoryGenerationResult =
  | { category: ImageCategory; status: "success"; imageUrls: string[] }
  | { category: ImageCategory; status: "error"; message: string };

const GENERATORS: Record<
  ImageCategory,
  (
    productType: ProductType,
    variables: ImagePromptVariables,
    referenceImages?: ReferenceImage[],
    productId?: string
  ) => Promise<string[]>
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
 *
 * `productType` picks which of that product type's own Hero/Lifestyle/
 * Closeup prompts to use — see lib/template-categories.ts's imageTemplateId.
 */
export async function generateAllImages(
  productType: ProductType,
  variables: ImagePromptVariables,
  referenceImages?: ReferenceImage[],
  categories?: ImageCategory[],
  productId?: string
): Promise<CategoryGenerationResult[]> {
  const requested =
    categories && categories.length > 0 ? categories : (Object.keys(GENERATORS) as ImageCategory[]);

  // Groups every category's generation (see generateForCategory's
  // traceGeneration call) under one parent trace in Langfuse, since they all
  // belong to the same "Generate" click — see observability.ts.
  return startActiveObservation("leonardo.generateAllImages", async (span): Promise<CategoryGenerationResult[]> => {
    span.update({ input: { productId, productType, categories: requested } });
    const settled = await Promise.allSettled(
      requested.map((category) => GENERATORS[category](productType, variables, referenceImages, productId))
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
  });
}

/**
 * Regenerates a single category on its own — this is what the Review
 * screen's per-section "Regenerate" button calls. Regenerating Hero, for
 * example, never touches Lifestyle/Closeup.
 */
export async function generateCategoryImages(
  productType: ProductType,
  category: ImageCategory,
  variables: ImagePromptVariables,
  referenceImages?: ReferenceImage[],
  productId?: string
): Promise<string[]> {
  return GENERATORS[category](productType, variables, referenceImages, productId);
}
