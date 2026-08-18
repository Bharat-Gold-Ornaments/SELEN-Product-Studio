import "server-only";
import { requireEnv, optionalEnv } from "@/lib/env";
import { readTemplate, renderTemplate } from "@/services/templates";
import { readAppSettings } from "@/services/app-settings";
import { imageTemplateId } from "@/lib/template-categories";
import type { ImageCategory, ProductType } from "@/types/product";
import type { ImagePromptVariables, ReferenceImage, CategoryGenerationResult } from "@/services/leonardo";

// ── Config ───────────────────────────────────────────────────────────────
// Kie.ai (https://docs.kie.ai) — a pay-as-you-go aggregator in front of
// several third-party image models. This mirrors services/leonardo.ts's
// public API exactly (same function names/signatures, same
// ImagePromptVariables/ReferenceImage/CategoryGenerationResult types,
// imported from there rather than redefined) so services/image-generation.ts
// can dispatch to either module interchangeably based on the Settings
// toggle, without either provider module knowing the other exists.

const KIE_API_BASE = "https://api.kie.ai";
// File uploads live on an entirely different domain than the generation
// API above — confirmed live (api.kie.ai/api/file-stream-upload 404s;
// this one doesn't). Kie's storage backend is a separate service
// ("redpandaai") fronting the same account/API key.
const KIE_UPLOAD_BASE = "https://kieai.redpandaai.co";
// Kie fronts several models under one endpoint, each with a separate
// text-to-image and image-to-image variant of the same base name (e.g.
// "gpt-image-2-text-to-image" / "gpt-image-2-image-to-image") — see Kie's
// Market page (kie.ai/market) for the full list. Defaults to GPT Image 2,
// matching what this app used on Leonardo, for the most comparable output
// between the two providers; override via KIE_MODEL_ID in .env.local with
// just the base name (no "-text-to-image"/"-image-to-image" suffix — that's
// added here depending on whether reference photos are present).
function kieModel(hasReference: boolean): string {
  const base = optionalEnv("KIE_MODEL_ID", "gpt-image-2");
  return hasReference ? `${base}-image-to-image` : `${base}-text-to-image`;
}
// Square, matching IMAGE_SIZE in leonardo.ts (1024x1024) as closely as
// Kie's enum-based sizing allows — Kie takes an aspect ratio + a resolution
// tier rather than exact pixel dimensions.
const ASPECT_RATIO = "1:1";
const RESOLUTION = "1K";
// Reference photos are uploaded here before each generation — see
// uploadReferenceImage(). Kie deletes uploaded files after 3 days on its
// own, so this never needs its own cleanup.
const UPLOAD_PATH = "selen-product-studio/references";
// Templates keep an optional "--- NEGATIVE PROMPT ---" section (any number
// of dashes, case-insensitive) — same convention as leonardo.ts, since both
// providers read the exact same template files. GPT Image 2 has no
// negative-prompt field on Kie either, so this gets folded into the main
// prompt as `avoid: "..."`, the same fix applied to Leonardo's v2 path.
const NEGATIVE_PROMPT_DELIMITER = /-{2,}\s*NEGATIVE PROMPT\s*-{2,}/i;
const POLL_INTERVAL_MS = 3000;
// Same reasoning as leonardo.ts's POLL_TIMEOUT_MS — this blocks inside a
// single request/response cycle, so it has to stay under whatever
// `maxDuration` the calling route sets.
const POLL_TIMEOUT_MS = 180_000;

// NOTE: field names below (data.taskId, data.state, data.resultJson) match
// Kie's documented /jobs/createTask + /jobs/recordInfo flow as of this
// writing (docs.kie.ai/market/common/get-task-detail). Worth a quick diff
// against the live docs if this starts failing unexpectedly.

interface KieResponse<T> {
  code: number;
  msg: string;
  data?: T;
}

interface KieTaskRecord {
  taskId: string;
  state: "waiting" | "queuing" | "generating" | "success" | "fail" | string;
  resultJson?: string;
  failMsg?: string;
}

async function kieFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const apiKey = requireEnv("KIE_API_KEY");
  const res = await fetch(`${KIE_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
      ...(init?.headers ?? {}),
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Kie API error ${res.status}: ${body || res.statusText}`);
  }

  const body = (await res.json()) as KieResponse<T>;
  // Kie reports application-level failures with an HTTP 200 and a non-200
  // `code` field, so res.ok alone (checked above) isn't enough.
  if (body.code !== 200) {
    throw new Error(`Kie API error: ${body.msg || `code ${body.code}`}`);
  }
  if (body.data === undefined) {
    throw new Error("Kie API returned no data.");
  }
  return body.data;
}

/**
 * Cheapest possible real proof the API key works — Kie's credit-balance
 * endpoint, not a generation. Used by Settings' Integration Status panel,
 * same pattern as checkLeonardoConnection.
 */
export async function checkKieConnection(): Promise<void> {
  await kieFetch<number>("/api/v1/chat/credit");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Uploads a reference photo to Kie's file storage and returns its public
 * download URL — Kie's `input_urls` field wants a URL it can fetch from
 * itself, unlike Leonardo's upload-then-reference-by-id flow. Files expire
 * off Kie's storage after 3 days on their own; nothing here needs to clean
 * them up.
 */
async function uploadReferenceImage(image: ReferenceImage): Promise<string> {
  const extension = (image.mimeType.split("/")[1] || "jpeg").replace("jpeg", "jpg");
  const form = new FormData();
  form.append("file", new Blob([Uint8Array.from(image.buffer)], { type: image.mimeType }), `reference.${extension}`);
  form.append("uploadPath", UPLOAD_PATH);

  const apiKey = requireEnv("KIE_API_KEY");
  const res = await fetch(`${KIE_UPLOAD_BASE}/api/file-stream-upload`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Kie reference photo upload failed ${res.status}: ${body || res.statusText}`);
  }
  const body = (await res.json()) as KieResponse<{ downloadUrl?: string }>;
  if (body.code !== 200 || !body.data?.downloadUrl) {
    throw new Error(`Kie reference photo upload failed: ${body.msg || "no downloadUrl returned"}`);
  }
  return body.data.downloadUrl;
}

interface CreateTaskInput {
  prompt: string;
  inputUrls?: string[];
}

async function createTask(input: CreateTaskInput): Promise<string> {
  const model = kieModel(Boolean(input.inputUrls && input.inputUrls.length > 0));
  const data = await kieFetch<{ taskId?: string }>("/api/v1/jobs/createTask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      input: {
        prompt: input.prompt,
        aspect_ratio: ASPECT_RATIO,
        resolution: RESOLUTION,
        ...(input.inputUrls && input.inputUrls.length > 0 ? { input_urls: input.inputUrls } : {}),
      },
    }),
  });

  if (!data.taskId) {
    throw new Error("Kie did not return a task id.");
  }
  return data.taskId;
}

async function pollTask(taskId: string): Promise<string[]> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const record = await kieFetch<KieTaskRecord>(`/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`);

    if (record.state === "success") {
      const parsed = record.resultJson ? (JSON.parse(record.resultJson) as { resultUrls?: string[] }) : {};
      const urls = parsed.resultUrls ?? [];
      if (urls.length === 0) {
        throw new Error("Kie reported the task as successful but returned no images.");
      }
      return urls;
    }

    if (record.state === "fail") {
      throw new Error(record.failMsg || "Kie reported the task as failed.");
    }

    await delay(POLL_INTERVAL_MS);
  }

  throw new Error("Timed out waiting for Kie to finish generating images.");
}

// ── Template-driven category generators ─────────────────────────────────
// Same REFERENCE_NOTE wording as leonardo.ts, deliberately — both providers
// read the exact same template files, so the {{referenceNote}} placeholder
// needs to fill in with the same instruction regardless of which is active.
const REFERENCE_NOTE =
  "Use the uploaded reference photos as the exact product reference — keep the design, proportions, gemstones, and finish unchanged.";

async function buildPrompt(
  productType: ProductType,
  category: ImageCategory,
  variables: ImagePromptVariables,
  hasReference: boolean
): Promise<string> {
  const template = await readTemplate(imageTemplateId(productType, category));
  const [positiveRaw, negativeRaw] = template.content.split(NEGATIVE_PROMPT_DELIMITER);

  const renderVars = { ...variables, referenceNote: hasReference ? REFERENCE_NOTE : "" };
  const prompt = renderTemplate(positiveRaw.trim(), renderVars);
  const negativePrompt = negativeRaw?.trim() ? renderTemplate(negativeRaw.trim(), renderVars) : undefined;

  return negativePrompt ? `${prompt}\n\navoid: "${negativePrompt}"` : prompt;
}

/**
 * Generates one category's images. Kie's GPT Image 2 models return exactly
 * one image per task (no `quantity`/`n` field exists on this endpoint —
 * confirmed against Kie's docs), so `numImages > 1` fires that many
 * independent tasks in parallel and pools their results, instead of the
 * single batched call Leonardo supports via `num_images`. Reference photos
 * are uploaded once and reused across every task, not re-uploaded per task.
 */
async function generateForCategory(
  productType: ProductType,
  category: ImageCategory,
  variables: ImagePromptVariables,
  numImages: number,
  referenceImages?: ReferenceImage[]
): Promise<string[]> {
  const hasReference = Boolean(referenceImages && referenceImages.length > 0);
  const prompt = await buildPrompt(productType, category, variables, hasReference);
  const inputUrls = hasReference
    ? await Promise.all(referenceImages!.map((image) => uploadReferenceImage(image)))
    : undefined;

  const results = await Promise.all(
    Array.from({ length: numImages }, async () => {
      const taskId = await createTask({ prompt, inputUrls });
      return pollTask(taskId);
    })
  );
  return results.flat();
}

export async function generateHero(
  productType: ProductType,
  variables: ImagePromptVariables,
  referenceImages?: ReferenceImage[]
): Promise<string[]> {
  const settings = await readAppSettings();
  return generateForCategory(productType, "hero", variables, settings.generationCounts.hero, referenceImages);
}

export async function generateLifestyle(
  productType: ProductType,
  variables: ImagePromptVariables,
  referenceImages?: ReferenceImage[]
): Promise<string[]> {
  const settings = await readAppSettings();
  return generateForCategory(
    productType,
    "lifestyle",
    variables,
    settings.generationCounts.lifestyle,
    referenceImages
  );
}

export async function generateCloseup(
  productType: ProductType,
  variables: ImagePromptVariables,
  referenceImages?: ReferenceImage[]
): Promise<string[]> {
  const settings = await readAppSettings();
  return generateForCategory(productType, "closeup", variables, settings.generationCounts.closeup, referenceImages);
}

// ── Orchestration ────────────────────────────────────────────────────────
// Mirrors leonardo.ts's GENERATORS/generateAllImages/generateCategoryImages
// exactly — see those doc comments for the shared behavior (Promise.allSettled
// so one category failing doesn't block the others, `categories` subsetting,
// etc.). Duplicated here rather than shared so this module has zero
// dependency on leonardo.ts's internals, only its exported types.

const GENERATORS: Record<
  ImageCategory,
  (
    productType: ProductType,
    variables: ImagePromptVariables,
    referenceImages?: ReferenceImage[]
  ) => Promise<string[]>
> = {
  hero: generateHero,
  lifestyle: generateLifestyle,
  closeup: generateCloseup,
};

export async function generateAllImages(
  productType: ProductType,
  variables: ImagePromptVariables,
  referenceImages?: ReferenceImage[],
  categories?: ImageCategory[]
): Promise<CategoryGenerationResult[]> {
  const requested =
    categories && categories.length > 0 ? categories : (Object.keys(GENERATORS) as ImageCategory[]);
  const settled = await Promise.allSettled(
    requested.map((category) => GENERATORS[category](productType, variables, referenceImages))
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

export async function generateCategoryImages(
  productType: ProductType,
  category: ImageCategory,
  variables: ImagePromptVariables,
  referenceImages?: ReferenceImage[]
): Promise<string[]> {
  return GENERATORS[category](productType, variables, referenceImages);
}
