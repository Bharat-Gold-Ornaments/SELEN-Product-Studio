import { NextResponse } from "next/server";
import { dismissDuplicatePair, listDismissedDuplicatePairs } from "@/services/inventory-duplicates";

/** Pair keys marked "Not a duplicate". */
export async function GET() {
  try {
    return NextResponse.json({ dismissed: await listDismissedDuplicatePairs() });
  } catch (error) {
    console.error("Failed to list dismissed duplicate pairs", error);
    const message = error instanceof Error ? error.message : "Couldn't load the duplicate check.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** Marks a pair "Not a duplicate" so it stops being suggested. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { skuA?: string; skuB?: string } | null;
  if (!body?.skuA?.trim() || !body.skuB?.trim()) {
    return NextResponse.json({ error: "Two SKUs are required." }, { status: 400 });
  }
  try {
    return NextResponse.json({ dismissed: await dismissDuplicatePair(body.skuA, body.skuB) });
  } catch (error) {
    console.error("Failed to dismiss duplicate pair", error);
    const message = error instanceof Error ? error.message : "Couldn't save that.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
