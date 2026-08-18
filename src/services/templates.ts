import "server-only";
import { promises as fs } from "fs";
import path from "path";
import {
  TEMPLATE_CATEGORIES,
  type TemplateCategoryId,
} from "@/lib/template-categories";
import { readTemplateFile, writeTemplateFile } from "@/services/google-drive";

const TEMPLATES_DIR = path.join(process.cwd(), "templates");

export interface TemplateRecord {
  id: TemplateCategoryId;
  label: string;
  description: string;
  variables: string[];
  content: string;
  updatedAt: string;
}

function driveFileName(id: TemplateCategoryId): string {
  return `${id}.txt`;
}

function seedFilePath(id: TemplateCategoryId): string {
  return path.join(TEMPLATES_DIR, driveFileName(id));
}

function categoryMeta(id: TemplateCategoryId) {
  const category = TEMPLATE_CATEGORIES.find((c) => c.id === id);
  if (!category) throw new Error(`Unknown template category: ${id}`);
  return category;
}

async function readSeed(id: TemplateCategoryId): Promise<{ content: string; updatedAt: string }> {
  const [content, stats] = await Promise.all([
    fs.readFile(seedFilePath(id), "utf-8"),
    fs.stat(seedFilePath(id)),
  ]);
  return { content, updatedAt: stats.mtime.toISOString() };
}

/**
 * Reads one template — from the Drive "Templates" folder (see
 * services/google-drive.ts) if it's been saved there before, falling back to
 * the seed copy bundled under /templates otherwise. Drive is the only place
 * an actual edit persists: on Vercel the deployed /templates files are
 * read-only at runtime, so this used to write straight to them, which threw
 * EROFS the moment anyone saved from a live instance. The local files now
 * serve purely as first-run defaults for whichever templates haven't been
 * saved through the Template Manager yet.
 */
export async function readTemplate(id: TemplateCategoryId): Promise<TemplateRecord> {
  const category = categoryMeta(id);
  const driveFile = await readTemplateFile(driveFileName(id));
  const { content, updatedAt } = driveFile ?? (await readSeed(id));

  return {
    id,
    label: category.label,
    description: category.description,
    variables: category.variables,
    content,
    updatedAt,
  };
}

export async function listTemplates(): Promise<TemplateRecord[]> {
  return Promise.all(TEMPLATE_CATEGORIES.map((category) => readTemplate(category.id)));
}

/**
 * Saves a template edit to Drive — the Template Manager's Save button. See
 * readTemplate's doc comment for why Drive, not the local file, is the only
 * persistence path now.
 */
export async function writeTemplate(
  id: TemplateCategoryId,
  content: string
): Promise<TemplateRecord> {
  const category = categoryMeta(id); // throws on unknown id
  if (!content.trim()) {
    throw new Error("Template content cannot be empty.");
  }
  const saved = await writeTemplateFile(driveFileName(id), content);

  return {
    id,
    label: category.label,
    description: category.description,
    variables: category.variables,
    content: saved.content,
    updatedAt: saved.updatedAt,
  };
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
