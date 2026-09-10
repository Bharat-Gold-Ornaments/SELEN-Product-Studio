import { NextResponse } from "next/server";
import { listCollections } from "@/services/shopify";

/** Discounts tab's Collection picker. */
export async function GET() {
  const collections = await listCollections();
  return NextResponse.json({ collections });
}
