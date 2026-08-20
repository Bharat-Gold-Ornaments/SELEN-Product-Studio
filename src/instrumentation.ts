/**
 * Next.js instrumentation hook — called once when a new server instance
 * boots, before any request is handled. This is where Langfuse observability
 * (see services/observability.ts) gets wired up: a Node OpenTelemetry tracer
 * provider whose only span processor exports to Langfuse.
 *
 * Deliberately does nothing if LANGFUSE_PUBLIC_KEY/LANGFUSE_SECRET_KEY aren't
 * set — this is optional observability, not a required integration (unlike
 * Drive/Sheets/Shopify in lib/env.ts), so a deployment that hasn't set up
 * Langfuse yet should build/boot/run exactly as before. When no provider is
 * registered here, every startObservation()/startActiveObservation() call
 * elsewhere in the app runs against OpenTelemetry's default no-op tracer —
 * harmless, no network calls, no errors.
 */
export async function register() {
  // instrumentation.ts also runs in the Edge runtime for middleware — the
  // Node OpenTelemetry SDK isn't Edge-compatible, and nothing in this app's
  // API routes runs on Edge anyway (every service here uses Node-only APIs:
  // Buffer, googleapis, etc.), so this only ever needs to do anything here.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (!process.env.LANGFUSE_PUBLIC_KEY || !process.env.LANGFUSE_SECRET_KEY) return;

  // Dynamically imported so these Node-only packages are never pulled into
  // whatever bundle Next.js builds for the Edge runtime, even though the
  // check above means their code never runs there.
  const { NodeTracerProvider } = await import("@opentelemetry/sdk-trace-node");
  const { LangfuseSpanProcessor } = await import("@langfuse/otel");

  const provider = new NodeTracerProvider({
    spanProcessors: [
      new LangfuseSpanProcessor({
        // Vercel serverless functions can freeze or terminate immediately
        // after the response is sent, before a normal batched exporter's
        // flush interval fires — "immediate" mode exports each span the
        // moment it ends instead, so a generation logged right before the
        // function exits still reaches Langfuse. See
        // node_modules/@langfuse/otel's LangfuseSpanProcessorParams doc.
        exportMode: "immediate",
      }),
    ],
  });
  // Registers this as the global OpenTelemetry tracer provider AND installs
  // Node's AsyncLocalStorage-based context manager — the latter is what
  // lets a generation started deep inside services/leonardo.ts or
  // services/anthropic-copy.ts correctly nest under the
  // startActiveObservation() span its caller opened, across every `await`
  // in between.
  provider.register();
}
