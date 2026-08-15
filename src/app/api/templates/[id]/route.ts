import { NextResponse } from "next/server";
import { z } from "zod";
import { isTemplateCategoryId } from "@/lib/template-categories";
import { writeTemplate } from "@/services/templates";

const bodySchema = z.object({
  content: z.string().min(1, "Template content cannot be empty."),
});

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  if (!isTemplateCategoryId(id)) {
    return NextResponse.json({ error: "Unknown template category." }, { status: 404 });
  }

  let content: string;
  try {
    const json = await request.json();
    content = bodySchema.parse(json).content;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  try {
    const template = await writeTemplate(id, content);
    return NextResponse.json({ template });
  } catch (error) {
    console.error(`Failed to save template "${id}"`, error);
    const message = error instanceof Error ? error.message : "Couldn't save the template.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
