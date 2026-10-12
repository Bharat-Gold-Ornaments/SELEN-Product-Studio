import { NextResponse } from "next/server";
import { retryPendingShopifyChanges } from "@/services/stock";

export const maxDuration = 60;

/** Re-sends every pending Stock Log change to Shopify. */
export async function POST() {
  try {
    return NextResponse.json(await retryPendingShopifyChanges());
  } catch (error) {
    console.error("Failed to retry pending Shopify stock changes", error);
    const message = error instanceof Error ? error.message : "Couldn't retry.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
