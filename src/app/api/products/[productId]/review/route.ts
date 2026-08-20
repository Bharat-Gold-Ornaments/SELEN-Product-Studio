import { NextResponse } from "next/server";
import { IMAGE_CATEGORIES } from "@/lib/constants";
import { buildImagePromptVariablesFromRecord } from "@/lib/generation-variables";
import { findProduct } from "@/services/google-sheets";
import { ensureProductFolders, listFiles, type ProductFolders } from "@/services/google-drive";
import type { CategoryGenerationResult } from "@/services/leonardo";
import type { ImageCategory } from "@/types/product";

// Matches the file names saveGeneratedImagesToDrive writes in
// services/product-generation.ts: "hero.jpg" when a category only produced
// one image, "hero-1.jpg"/"hero-2.jpg"/... when it produced several.
const GENERATED_FILE_PATTERN = /^(hero|lifestyle|closeup)(?:-(\d+))?\.[a-zA-Z0-9]+$/;
// Matches the manual-upload filenames api/products/[productId]/upload-image/
// route.ts writes — deliberately distinct from GENERATED_FILE_PATTERN (no
// numeric suffix) so the two never collide, and a manual upload is always
// exactly one file per category, never grouped into the AI candidates list.
const MANUAL_FILE_PATTERN = /^(hero|lifestyle|closeup)-manual\.[a-zA-Z0-9]+$/;

function groupByCategory(files: { name: string; publicUrl: string }[]): Record<ImageCategory, string[]> {
  const grouped: Record<ImageCategory, { index: number; url: string }[]> = {
    hero: [],
    lifestyle: [],
    closeup: [],
  };

  for (const file of files) {
    const match = file.name.match(GENERATED_FILE_PATTERN);
    if (!match) continue;
    const category = match[1] as ImageCategory;
    const index = match[2] ? Number(match[2]) : 0;
    grouped[category].push({ index, url: file.publicUrl });
  }

  return {
    hero: grouped.hero.sort((a, b) => a.index - b.index).map((f) => f.url),
    lifestyle: grouped.lifestyle.sort((a, b) => a.index - b.index).map((f) => f.url),
    closeup: grouped.closeup.sort((a, b) => a.index - b.index).map((f) => f.url),
  };
}

function groupManualUploads(files: { name: string; publicUrl: string }[]): Partial<Record<ImageCategory, string>> {
  const manualUploads: Partial<Record<ImageCategory, string>> = {};
  for (const file of files) {
    const match = file.name.match(MANUAL_FILE_PATTERN);
    if (!match) continue;
    manualUploads[match[1] as ImageCategory] = file.publicUrl;
  }
  return manualUploads;
}

/**
 * Reloads an already-generated product for the Review screen from Google
 * Sheets + Drive, since generation results otherwise only live in the
 * browser's in-memory session (see hooks/use-generation.ts) and disappear on
 * refresh or when navigating back from the Products list. Non-destructive:
 * only reads the sheet row and lists the product's `generated` Drive folder,
 * it never re-runs Leonardo.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ productId: string }> }) {
  const { productId } = await params;

  const lookup = await findProduct(productId).catch((error) => {
    console.error(`Couldn't read product ${productId} from Google Sheets`, error);
    return null;
  });

  if (!lookup) {
    return NextResponse.json({ error: "Product not found." }, { status: 404 });
  }
  const { record } = lookup;

  let driveFolders: ProductFolders | null = null;
  let generatedFiles: { name: string; publicUrl: string }[] = [];
  try {
    driveFolders = await ensureProductFolders(record.category, productId);
    generatedFiles = await listFiles(driveFolders.generatedFolderId);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Couldn't load this product's images from Drive.",
      },
      { status: 502 }
    );
  }

  const grouped = groupByCategory(generatedFiles);
  const manualUploads = groupManualUploads(generatedFiles);
  const imageResults: CategoryGenerationResult[] = IMAGE_CATEGORIES.map((category) => {
    const imageUrls = grouped[category];
    return imageUrls.length > 0
      ? { category, status: "success" as const, imageUrls }
      : { category, status: "error" as const, message: "No generated images found for this category." };
  });

  // Pre-select whichever image is already saved as this category's chosen
  // link in the sheet, so a reloaded product looks the same as it did right
  // after the user picked it, not as if nothing had been chosen yet. Checked
  // against both the AI candidates and the manual upload — either is a
  // valid source for what got saved.
  const linkByCategory: Record<ImageCategory, string> = {
    hero: record.heroImageLink,
    lifestyle: record.lifestyleImageLink,
    closeup: record.closeupImageLink,
  };
  const selected: Partial<Record<ImageCategory, string>> = {};
  for (const category of IMAGE_CATEGORIES) {
    const link = linkByCategory[category];
    if (link && (grouped[category].includes(link) || manualUploads[category] === link)) {
      selected[category] = link;
    }
  }

  // Copy (Milestone 7) was only ever saved as a full set (see the PATCH
  // handler in api/products/[productId]/copy/route.ts) — description is
  // empty until that happens, and empty is otherwise a valid value for
  // every other copy field (a brand-new product, tags not yet generated,
  // etc.), so it's the one reliable signal that copy exists at all.
  const copy =
    record.description.trim().length > 0
      ? {
          title: record.title,
          description: record.description,
          tags: record.tags,
          seoTitle: record.seoTitle,
          metaDescription: record.metaDescription,
          collections: record.collections,
        }
      : null;

  return NextResponse.json({
    productId,
    productType: record.category,
    driveFolders,
    driveError: null,
    sheetsError: null,
    imageResults,
    variables: buildImagePromptVariablesFromRecord(record),
    selected,
    copy,
    manualUploads,
  });
}
