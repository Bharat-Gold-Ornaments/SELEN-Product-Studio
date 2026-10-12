import { NextResponse } from "next/server";
import { mergeInventoryItems, StockInputError } from "@/services/stock";

/** Combines two Inventory rows for the same design into one. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as
    | { keepSku?: string; removeSku?: string; recordedBy?: string }
    | null;
  if (!body) return NextResponse.json({ error: "Invalid request body." }, { status: 400 });

  try {
    const result = await mergeInventoryItems(
      String(body.keepSku ?? ""),
      String(body.removeSku ?? ""),
      String(body.recordedBy ?? "")
    );
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof StockInputError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Failed to merge inventory items", error);
    const message = error instanceof Error ? error.message : "Couldn't merge these items.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
