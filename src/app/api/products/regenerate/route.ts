import { NextResponse } from "next/server";
import { z } from "zod";
import { IMAGE_CATEGORIES } from "@/lib/constants";
import { regenerateCategory } from "@/services/product-generation";
import { downloadFile, listFiles, driveFileIdFromImageProxyUrl } from "@/services/google-drive";
import type { ProductType } from "@/types/product";

// Matches the file names uploadOriginals writes in
// services/product-generation.ts: "front.jpg" / "side.jpg" / "worn.jpg" —
// always a literal ".jpg" extension regardless of the original upload's real
// mime type (see uploadOriginals's uploadOriginal call).
const ORIGINAL_PHOTO_FILENAMES = { front: "front.jpg", side: "side.jpg", worn: "worn.jpg" } as const;

// Matches generate/route.ts's maxDuration — a regenerate is a single
// category's worth of the same generation flow, so it needs the same
// ceiling above services/kie.ts's or services/leonardo.ts's POLL_TIMEOUT_MS.
export const maxDuration = 180;

const metaSchema = z.object({
  // Only used for tagging this regenerate's Langfuse observability trace
  // (see services/observability.ts) so it's filterable by product — never
  // looked up or written anywhere. Optional so an older client that hasn't
  // been redeployed yet doesn't fail validation.
  productId: z.string().optional(),
  category: z.enum(IMAGE_CATEGORIES),
  // Picks which product type's own Hero/Lifestyle/Closeup prompt to use —
  // each product type has its own independently-editable template now (see
  // lib/template-categories.ts), so this can't be inferred from `category`
  // alone the way it could when every product type shared one prompt.
  productType: z.string(),
  variables: z.object({
    productType: z.string(),
    finish: z.string(),
    stone: z.string(),
    dimensions: z.string(),
    collections: z.string(),
  }),
  // Drive file ids for any slot that was originally filled from the
  // Uploads pool rather than a local file (session.poolPhotoIds) — these
  // don't come through as `referencePhoto` FormData entries since there's
  // no local File for them, so they're downloaded from Drive here instead.
  // Not re-marked "used" — that already happened on the initial generation
  // that first consumed this photo, not on every subsequent regenerate.
  poolPhotoIds: z
    .object({ front: z.string().optional(), side: z.string().optional(), worn: z.string().optional() })
    .optional(),
  // The product's existing Drive "generated" folder id, sent by the Review
  // screen from its session (created during the initial generation) — lets
  // a regenerated image get saved to Drive the same way the initial batch
  // does. Optional/nullable since a product whose Drive setup failed has
  // no folder to save into; the regenerated image still works, it just
  // isn't persisted to Drive in that case (same as the initial batch).
  generatedFolderId: z.string().nullable().optional(),
  // The product's Drive "originals" folder id — sent so Regenerate can
  // recover the original front/side/worn reference photos from Drive when
  // neither a local File nor a poolPhotoIds entry is available for them
  // (see the fallback below). This is the common case: originalPhotos and
  // poolPhotoIds are both in-memory-only client state that's lost on a
  // page refresh or a fresh visit to Review from the Products list (see
  // GenerationSession's doc comment in hooks/use-generation.ts) — without
  // this fallback, Regenerate after a reload silently ran as pure
  // text-to-image, no reference photo at all.
  originalsFolderId: z.string().nullable().optional(),
});

/**
 * FormData rather than JSON: regenerating a category can optionally re-send
 * the reference photos used for the initial generation (all of them, not
 * just one — see product-generation.ts), so the regenerated image stays
 * visually consistent with the rest of the set (image-to-image — see
 * services/leonardo.ts). The photos are entirely optional here too,
 * matching the rest of the app. The client appends every photo under the
 * same "referencePhoto" key — FormData natively supports repeated keys, and
 * getAll() retrieves them all in the order they were appended.
 */
export async function POST(request: Request) {
  const formData = await request.formData();

  const metaRaw = formData.get("meta");
  if (typeof metaRaw !== "string") {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }

  let meta: z.infer<typeof metaSchema>;
  try {
    meta = metaSchema.parse(JSON.parse(metaRaw));
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const referenceFiles = formData.getAll("referencePhoto").filter((f): f is File => f instanceof File);
  const localReferenceImages = await Promise.all(
    referenceFiles.map(async (file) => ({
      buffer: Buffer.from(await file.arrayBuffer()),
      mimeType: file.type || "image/jpeg",
    }))
  );

  const poolFileIds = Object.values(meta.poolPhotoIds ?? {}).filter((id): id is string => Boolean(id));
  const poolReferenceImages = await Promise.all(
    poolFileIds.map(async (fileId) => {
      const { buffer, mimeType } = await downloadFile(fileId);
      return { buffer, mimeType };
    })
  );

  // Fallback only when the client sent nothing at all for image-to-image
  // reference — a same-tab regenerate right after Generate still has real
  // originalPhotos/poolPhotoIds in memory and should keep using those as
  // before; hitting Drive here too would be redundant. See
  // originalsFolderId's schema comment above for when this actually fires.
  let driveOriginalImages: { buffer: Buffer; mimeType: string }[] = [];
  if (localReferenceImages.length === 0 && poolReferenceImages.length === 0 && meta.originalsFolderId) {
    try {
      const files = await listFiles(meta.originalsFolderId);
      const byName = new Map(files.map((f) => [f.name, f]));
      const originalFiles = (["front", "side", "worn"] as const)
        .map((field) => byName.get(ORIGINAL_PHOTO_FILENAMES[field]))
        .filter((f): f is { name: string; publicUrl: string } => Boolean(f));
      driveOriginalImages = await Promise.all(
        originalFiles.map(async (file) => {
          const fileId = driveFileIdFromImageProxyUrl(file.publicUrl);
          const { buffer, mimeType } = await downloadFile(fileId);
          return { buffer, mimeType };
        })
      );
    } catch (error) {
      // Non-fatal — regeneration still works, it just falls back to
      // text-to-image, same as if originalsFolderId had never been sent.
      console.error(`Failed to recover original reference photos from Drive for regenerate:`, error);
    }
  }

  const referenceImages = [...localReferenceImages, ...poolReferenceImages, ...driveOriginalImages];

  const result = await regenerateCategory(
    meta.productType as ProductType,
    meta.category,
    meta.variables,
    referenceImages,
    meta.generatedFolderId ?? null,
    meta.productId
  );
  return NextResponse.json({ result });
}
