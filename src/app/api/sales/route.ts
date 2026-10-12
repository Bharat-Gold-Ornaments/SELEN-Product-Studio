import { NextResponse } from "next/server";
import { recordSales, StockInputError } from "@/services/stock";
import type { RecordSalesInput } from "@/types/stock-log";

// One Sheet read/write per step plus a Shopify call per SKU sold.
export const maxDuration = 60;

/** Records a day's offline sales: Inventory goes down, a Stock Log row per SKU, then Shopify. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Partial<RecordSalesInput> | null;
  if (!body || !Array.isArray(body.lines)) {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  try {
    const result = await recordSales({
      date: String(body.date ?? ""),
      recordedBy: String(body.recordedBy ?? ""),
      lines: body.lines.map((line) => ({ sku: String(line?.sku ?? ""), quantity: Number(line?.quantity) })),
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof StockInputError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Failed to record sales", error);
    const message = error instanceof Error ? error.message : "Couldn't record these sales.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
