import { NextResponse } from "next/server";
import { getRateChangeLog } from "@/services/pricing";

/** Settings' Rate Change Audit Log panel — see spec Section 9. */
export async function GET() {
  const entries = await getRateChangeLog();
  return NextResponse.json({ entries });
}
