import { NextResponse } from "next/server";
import { runReconciliation } from "@/services/reconciliation";

// A full Shopify product read (paged) plus two Sheet reads.
export const maxDuration = 60;

export async function GET() {
  try {
    return NextResponse.json(await runReconciliation());
  } catch (error) {
    console.error("Reconciliation failed", error);
    const message = error instanceof Error ? error.message : "Couldn't run the reconciliation.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
