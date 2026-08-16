import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { requireEnv, optionalEnv } from "@/lib/env";
import { readTemplate, renderTemplate } from "@/services/templates";
import type { ImagePromptVariables } from "@/lib/generation-variables";

// ── Config ───────────────────────────────────────────────────────────────

// Two tiers, matching where quality actually matters for a luxury brand:
// Title and Description are the copy a customer reads, so they get the
// stronger model. Tags and SEO metadata are short, formulaic, and mostly
// mechanical (comma lists, fixed-format fields), so the faster/cheaper
// model is plenty. Both overridable per-deployment without a code change.
const MODEL_PRIMARY = optionalEnv("ANTHROPIC_MODEL_PRIMARY", "claude-sonnet-5");
const MODEL_FAST = optionalEnv("ANTHROPIC_MODEL_FAST", "claude-haiku-4-5-20251001");

let cachedClient: Anthropic | null = null;

function getClient(): Anthropic {
  if (cachedClient) return cachedClient;
  cachedClient = new Anthropic({ apiKey: requireEnv("ANTHROPIC_API_KEY") });
  return cachedClient;
}

/**
 * Proof the API key works, without spending a single completion token — the
 * SDK version pinned here (0.32.1) predates the `models` resource, so this
 * hits the same `/v1/models` listing endpoint directly rather than through
 * the client. It's a metadata read (which models the key can see), not an
 * inference call, so it costs nothing beyond the request itself. Used by
 * Settings' Integration Status panel.
 */
export async function checkAnthropicConnection(): Promise<void> {
  const res = await fetch("https://api.anthropic.com/v1/models?limit=1", {
    headers: {
      "x-api-key": requireEnv("ANTHROPIC_API_KEY"),
      "anthropic-version": "2023-06-01",
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Anthropic API error ${res.status}: ${body || res.statusText}`);
  }
}

async function complete(model: string, prompt: string, maxTokens: number): Promise<string> {
  const client = getClient();
  const response = await client.messages.create({
    model,
    max_tokens: maxTokens,
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();

  if (!text) {
    throw new Error(`Claude (${model}) returned an empty response.`);
  }
  return text;
}

// Templates are instructed to "respond with only the X, nothing else," but
// models occasionally wrap short answers in quotes anyway — stripped
// defensively rather than trusted to never happen.
function stripWrappingQuotes(text: string): string {
  const trimmed = text.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

// ── Template-driven field generators ────────────────────────────────────

/** Variables a product's copy templates need — same shape as the image templates' variables, plus the title once one exists. */
export type CopyPromptVariables = ImagePromptVariables & { title: string };

export async function generateTitle(variables: ImagePromptVariables): Promise<string> {
  const template = await readTemplate("title");
  // Spread into a fresh object literal rather than passing `variables`
  // directly — renderTemplate's Record<string, string> parameter requires
  // an explicit index signature from a named interface type, but a fresh
  // literal is checked structurally instead and satisfies it without one.
  const prompt = renderTemplate(template.content, { ...variables });
  const text = await complete(MODEL_PRIMARY, prompt, 30);
  return stripWrappingQuotes(text);
}

export async function generateDescription(variables: CopyPromptVariables): Promise<string> {
  const template = await readTemplate("description");
  const prompt = renderTemplate(template.content, { ...variables });
  const text = await complete(MODEL_PRIMARY, prompt, 400);
  return stripWrappingQuotes(text);
}

export async function generateTags(variables: CopyPromptVariables): Promise<string[]> {
  const template = await readTemplate("tags");
  const prompt = renderTemplate(template.content, { ...variables });
  const text = await complete(MODEL_FAST, prompt, 100);
  return text
    .split(",")
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean);
}

export interface SeoCopy {
  seoTitle: string;
  metaDescription: string;
}

// Parses the fixed "SEO Title: ...\nMeta Description: ..." format the seo.txt
// template requests. Falls back to putting the whole response in seoTitle
// (truncated) rather than throwing if the model doesn't follow the format
// exactly — a malformed-but-present response is more useful to show the
// user (who can just regenerate or edit) than a hard failure.
function parseSeoResponse(text: string): SeoCopy {
  const titleMatch = text.match(/SEO Title:\s*(.+)/i);
  const descMatch = text.match(/Meta Description:\s*(.+)/i);
  if (titleMatch && descMatch) {
    return {
      seoTitle: titleMatch[1].trim(),
      metaDescription: descMatch[1].trim(),
    };
  }
  return { seoTitle: text.slice(0, 60).trim(), metaDescription: text.slice(0, 160).trim() };
}

export async function generateSeo(variables: CopyPromptVariables): Promise<SeoCopy> {
  const template = await readTemplate("seo");
  const prompt = renderTemplate(template.content, { ...variables });
  const text = await complete(MODEL_FAST, prompt, 150);
  return parseSeoResponse(text);
}

// ── Orchestration ────────────────────────────────────────────────────────

export type CopyFieldResult<T> =
  | { status: "success"; value: T }
  | { status: "error"; message: string };

export interface CopyGenerationResult {
  title: CopyFieldResult<string>;
  description: CopyFieldResult<string>;
  tags: CopyFieldResult<string[]>;
  seo: CopyFieldResult<SeoCopy>;
}

function errorMessage(reason: unknown, fallback: string): string {
  return reason instanceof Error ? reason.message : fallback;
}

/**
 * Generates a single field on its own — this is what the Review screen's
 * per-field "Regenerate" button calls (mirrors regenerateCategory in
 * product-generation.ts for images). Never throws: like the image
 * generators' error handling, a failure comes back as a normal
 * `{ status: "error" }` result so the route can always respond 200 and let
 * the UI show the failure inline next to that one field. Regenerating
 * description/tags/seo needs the *current* title (whatever the user has
 * approved or edited on screen, not necessarily what was last generated),
 * so callers must pass it in for anything but "title".
 */
export async function generateCopyField(
  field: "title" | "description" | "tags" | "seo",
  variables: ImagePromptVariables,
  title?: string
): Promise<CopyFieldResult<string | string[] | SeoCopy>> {
  try {
    if (field === "title") {
      return { status: "success", value: await generateTitle(variables) };
    }
    if (!title || !title.trim()) {
      throw new Error(`Regenerating ${field} needs a title first.`);
    }
    const withTitle: CopyPromptVariables = { ...variables, title };
    if (field === "description") {
      return { status: "success", value: await generateDescription(withTitle) };
    }
    if (field === "tags") {
      return { status: "success", value: await generateTags(withTitle) };
    }
    return { status: "success", value: await generateSeo(withTitle) };
  } catch (error) {
    return { status: "error", message: errorMessage(error, `${field} generation failed.`) };
  }
}

/**
 * Generates all four copy fields for a product. Title is generated first
 * and, unlike the other three, is a hard dependency for them (they all
 * reference {{title}}) — so if title generation fails, the rest are marked
 * as skipped rather than attempted with a missing title. Once title
 * succeeds, description/tags/SEO run independently via `Promise.allSettled`
 * so a failure in one never blocks the other two, matching how
 * generateAllImages treats Hero/Lifestyle/Closeup in services/leonardo.ts.
 */
export async function generateAllCopy(variables: ImagePromptVariables): Promise<CopyGenerationResult> {
  let title: string;
  try {
    title = await generateTitle(variables);
  } catch (error) {
    const message = errorMessage(error, "Title generation failed.");
    const skipped = { status: "error" as const, message: "Skipped — title generation failed." };
    return {
      title: { status: "error", message },
      description: skipped,
      tags: skipped,
      seo: skipped,
    };
  }

  const withTitle: CopyPromptVariables = { ...variables, title };
  const [descriptionResult, tagsResult, seoResult] = await Promise.allSettled([
    generateDescription(withTitle),
    generateTags(withTitle),
    generateSeo(withTitle),
  ]);

  return {
    title: { status: "success", value: title },
    description:
      descriptionResult.status === "fulfilled"
        ? { status: "success", value: descriptionResult.value }
        : { status: "error", message: errorMessage(descriptionResult.reason, "Description generation failed.") },
    tags:
      tagsResult.status === "fulfilled"
        ? { status: "success", value: tagsResult.value }
        : { status: "error", message: errorMessage(tagsResult.reason, "Tags generation failed.") },
    seo:
      seoResult.status === "fulfilled"
        ? { status: "success", value: seoResult.value }
        : { status: "error", message: errorMessage(seoResult.reason, "SEO generation failed.") },
  };
}
