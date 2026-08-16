/**
 * Centralized, typed access to environment variables.
 *
 * Design decision: we validate lazily (at call time, inside the server code
 * path that actually needs the value) rather than eagerly at module import.
 * Eager/top-level validation would crash `next build` and local development
 * for every developer who hasn't configured every third-party integration
 * yet. Each service module (Leonardo, Google Drive, Sheets, Shopify,
 * Anthropic) calls `requireEnv` only when it is actually invoked, so the app
 * always builds and boots, and fails loudly — with a clear message — the
 * moment a specific integration is used without being configured.
 */

const missingEnvMessage = (name: string) =>
  `Missing required environment variable: ${name}. Add it to your .env.local ` +
  `(see .env.example) or your Vercel project's environment variables.`;

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(missingEnvMessage(name));
  }
  return value;
}

export function optionalEnv(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.trim() !== "" ? value : fallback;
}

/** Non-secret, safe-to-eval-anytime config. */
export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  isProduction: process.env.NODE_ENV === "production",
  sessionCookieName: "selen_session",
} as const;
