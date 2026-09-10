import { NextResponse } from "next/server";
import { listAllTags } from "@/services/shopify";

/** Discounts tab's Tag picker. */
export async function GET() {
  const tags = await listAllTags();
  return NextResponse.json({ tags });
}
