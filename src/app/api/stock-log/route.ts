import { NextResponse } from "next/server";
import { listStockLogEntries } from "@/services/google-sheets";

/** Every Stock Log row — the Sales page filters by date and type itself. */
export async function GET() {
  try {
    return NextResponse.json({ entries: await listStockLogEntries() });
  } catch (error) {
    console.error("Failed to list the Stock Log", error);
    const message = error instanceof Error ? error.message : "Couldn't load the stock log.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
