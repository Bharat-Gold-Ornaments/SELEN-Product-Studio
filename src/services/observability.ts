import "server-only";
import { startObservation, startActiveObservation } from "@langfuse/tracing";

export { startActiveObservation };

/**
 * Formats a base64 image as a data URI so Langfuse's span processor
 * (mediaUploadEnabled — on by default, see instrumentation.ts) detects it
 * inside a generation's `input` and swaps it for an uploaded media
 * reference. Without this, "which image was sent" would mean scrolling a
 * multi-MB base64 blob in the Langfuse UI instead of seeing the actual
 * photo.
 */
export function imageDataUri(mimeType: string, base64Data: string): string {
  return `data:${mimeType};base64,${base64Data}`;
}

interface GenerationUpdate {
  output: unknown;
  usageDetails?: Record<string, number>;
}

interface TraceGenerationParams<T> {
  /** Observation name shown in the Langfuse UI, e.g. "anthropic.title", "leonardo.hero". */
  name: string;
  model: string;
  /** Exactly what was sent to the model — prompt text, image data URIs (see imageDataUri), etc. */
  input: unknown;
  metadata?: Record<string, unknown>;
  run: () => Promise<T>;
  /** Maps the successful result to what gets logged as `output` (and, optionally, token usage). */
  toUpdate: (result: T) => GenerationUpdate;
}

/**
 * Wraps a single call to an LLM or image-generation API as a Langfuse
 * "generation" observation: logs the exact input on start, the mapped
 * output on success, or the error message (with level "ERROR") on failure —
 * then always ends the observation. This is the one place that pattern is
 * written, rather than repeating try/update/end at every call site in
 * services/anthropic-copy.ts, services/leonardo.ts, and services/kie.ts.
 *
 * Safe to call unconditionally regardless of whether Langfuse is configured
 * — see instrumentation.ts's doc comment.
 */
export async function traceGeneration<T>(params: TraceGenerationParams<T>): Promise<T> {
  const generation = startObservation(
    params.name,
    { model: params.model, input: params.input, metadata: params.metadata },
    { asType: "generation" }
  );
  try {
    const result = await params.run();
    const { output, usageDetails } = params.toUpdate(result);
    generation.update({ output, usageDetails });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    generation.update({ level: "ERROR", statusMessage: message, output: { error: message } });
    throw error;
  } finally {
    generation.end();
  }
}
