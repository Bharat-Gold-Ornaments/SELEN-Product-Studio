import { NextResponse } from "next/server";
import { listTemplates } from "@/services/templates";

export async function GET() {
  try {
    const templates = await listTemplates();
    return NextResponse.json({ templates });
  } catch (error) {
    console.error("Failed to list templates", error);
    return NextResponse.json({ error: "Couldn't load templates." }, { status: 500 });
  }
}
