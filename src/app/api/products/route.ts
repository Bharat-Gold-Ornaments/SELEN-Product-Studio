import { NextResponse } from "next/server";
import { listProducts } from "@/services/google-sheets";

export async function GET() {
  try {
    const products = await listProducts();
    return NextResponse.json({ products });
  } catch (error) {
    console.error("Failed to list products", error);
    // This is an internal single-tenant admin tool, not multi-tenant SaaS —
    // surfacing the real Google API error text (missing env var, sheet not
    // shared, wrong tab name, etc.) to the dashboard is far more useful for
    // self-diagnosis than a generic message, and there's no other user who
    // could see it.
    const message = error instanceof Error ? error.message : "Couldn't load products from Google Sheets.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
