import { NextResponse } from "next/server";
import { StockInputError, undoSale } from "@/services/stock";

/** Reverses a recorded sale with a new correction row. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as { recordedBy?: string } | null;

  try {
    const entry = await undoSale(id, String(body?.recordedBy ?? ""));
    return NextResponse.json({ entry });
  } catch (error) {
    if (error instanceof StockInputError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error(`Failed to undo sale ${id}`, error);
    const message = error instanceof Error ? error.message : "Couldn't undo this sale.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
