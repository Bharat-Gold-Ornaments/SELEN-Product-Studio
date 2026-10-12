import { NextResponse } from "next/server";
import { getOnlineSyncState, syncOnlineOrders } from "@/services/online-orders";
import { StockInputError } from "@/services/stock";

// Pages through recent orders, then one Sheet write and a Shopify call per pending change.
export const maxDuration = 60;

/** What the last sync found — no Shopify call. `state` is null before the first sync. */
export async function GET() {
  try {
    return NextResponse.json({ state: await getOnlineSyncState() });
  } catch (error) {
    console.error("Failed to read the online orders sync state", error);
    const message = error instanceof Error ? error.message : "Couldn't load the online orders status.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** Imports new online sales and Shopify restocks into Inventory. */
export async function POST() {
  try {
    return NextResponse.json(await syncOnlineOrders());
  } catch (error) {
    if (error instanceof StockInputError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Failed to sync online orders", error);
    const message = error instanceof Error ? error.message : "Couldn't sync online orders.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
