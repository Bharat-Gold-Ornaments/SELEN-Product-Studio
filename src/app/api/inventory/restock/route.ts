import { NextResponse } from "next/server";
import { restockItem, StockInputError } from "@/services/stock";

export const maxDuration = 60;

/** More pieces of a design already in Inventory: stock goes up on Inventory and Shopify. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as
    | { sku?: string; quantity?: number; recordedBy?: string; date?: string }
    | null;
  if (!body) return NextResponse.json({ error: "Invalid request body." }, { status: 400 });

  try {
    const entry = await restockItem(
      String(body.sku ?? ""),
      Number(body.quantity),
      String(body.recordedBy ?? ""),
      String(body.date ?? "")
    );
    return NextResponse.json({ entry });
  } catch (error) {
    if (error instanceof StockInputError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Failed to restock", error);
    const message = error instanceof Error ? error.message : "Couldn't add this stock.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
