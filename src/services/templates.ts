import "server-only";
import { promises as fs } from "fs";
import path from "path";
import {
  TEMPLATE_CATEGORIES,
  type TemplateCategoryId,
} from "@/lib/template-categories";

const TEMPLATES_DIR = path.join(process.cwd(), "templates");

export interface TemplateRecord {
  id: TemplateCategoryId;
  label: string;
  description: string;
  variables: string[];
  content: string;
  updatedAt: string;
}

function filePath(id: TemplateCategoryId): string {
  return path.join(TEMPLATES_DIR, `${id}.txt`);
}

function categoryMeta(id: TemplateCategoryId) {
  const category = TEMPLATE_CATEGORIES.find((c) => c.id === id);
  if (!category) throw new Error(`Unknown template category: ${id}`);
  return category;
}

/**
 * Reads one template from disk.
 *
 * Storage note: in local development, and any non-serverless deployment,
 * this reads/writes real files under /templates, so edits made in the
 * Template Manager persist immediately — there is nothing fake about this
 * implementation. On Vercel specifically, the filesystem is read-only at
 * runtime, so writes made here won't persist across invocations or
 * redeploys; Milestone 4 adds a Google-Drive-backed implementation behind
 * this exact function signature so callers (the API routes, and later the
 * Leonardo/Anthropic services) never have to change.
 */
export async function readTemplate(id: TemplateCategoryId): Promise<TemplateRecord> {
  const category = categoryMeta(id);
  const [content, stats] = await Promise.all([
    fs.readFile(filePath(id), "utf-8"),
    fs.stat(filePath(id)),
  ]);

  return {
    id,
    label: category.label,
    description: category.description,
    variables: category.variables,
    content,
    updatedAt: stats.mtime.toISOString(),
  };
}

export async function listTemplates(): Promise<TemplateRecord[]> {
  return Promise.all(TEMPLATE_CATEGORIES.map((category) => readTemplate(category.id)));
}

export async function writeTemplate(
  id: TemplateCategoryId,
  content: string
): Promise<TemplateRecord> {
  categoryMeta(id); // throws on unknown id
  if (!content.trim()) {
    throw new Error("Template content cannot be empty.");
  }
  await fs.writeFile(filePath(id), content, "utf-8");
  return readTemplate(id);
}

/**
 * Simple {{variable}} substitution — intentionally no conditionals or
 * loops. The Leonardo service (Milestone 5) and the Anthropic copy service
 * (Milestone 7) both call `readTemplate` then `renderTemplate` to turn a
 * loaded template into the final prompt sent to each API. Unrecognized
 * placeholders are left untouched rather than silently dropped, so a typo
 * in a template is easy to spot.
 */
export function renderTemplate(content: string, variables: Record<string, string>): string {
  return content.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key: string) =>
    key in variables ? variables[key] : match
  );
}
