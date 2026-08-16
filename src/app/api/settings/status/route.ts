import { NextResponse } from "next/server";
import { checkLeonardoConnection } from "@/services/leonardo";
import { checkDriveConnection } from "@/services/google-drive";
import { checkSheetsConnection } from "@/services/google-sheets";
import { checkAnthropicConnection } from "@/services/anthropic-copy";
import { checkShopifyConnection } from "@/services/shopify";

export const maxDuration = 30;

interface ServiceCheck {
  id: string;
  label: string;
  check: () => Promise<void>;
}

const CHECKS: ServiceCheck[] = [
  { id: "leonardo", label: "Leonardo (image generation)", check: checkLeonardoConnection },
  { id: "drive", label: "Google Drive (photo storage)", check: checkDriveConnection },
  { id: "sheets", label: "Google Sheets (product data)", check: checkSheetsConnection },
  { id: "anthropic", label: "Anthropic (AI copy)", check: checkAnthropicConnection },
  { id: "shopify", label: "Shopify (publishing)", check: checkShopifyConnection },
];

/**
 * Runs a cheap, real connectivity check against every integration this app
 * depends on — not just "is the env var set" (env.ts's lazy validation
 * already implies that, by throwing the first time a service is actually
 * used) but "does the credential actually work right now." Each check runs
 * independently via Promise.allSettled so one broken integration never
 * hides the status of the other four, and each check function throws its
 * own real, specific error message (see each service's check* function) —
 * this route just relays it rather than replacing it with something
 * generic.
 */
export async function GET() {
  const results = await Promise.allSettled(CHECKS.map((c) => c.check()));

  const services = CHECKS.map((c, i) => {
    const result = results[i];
    return {
      id: c.id,
      label: c.label,
      ok: result.status === "fulfilled",
      message: result.status === "rejected" ? errorMessage(result.reason) : null,
    };
  });

  return NextResponse.json({ services });
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : "Check failed.";
}
