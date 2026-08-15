import { NextResponse } from "next/server";
import { z } from "zod";
import { IMAGE_CATEGORIES } from "@/lib/constants";
import { regenerateCategory } from "@/services/product-generation";
import { downloadFile } from "@/services/google-drive";

export const maxDuration = 60;

const metaSchema = z.object({
  category: z.enum(IMAGE_CATEGORIES),
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

  const referenceImages = [...localReferenceImages, ...poolReferenceImages];

  const result = await regenerateCategory(
    meta.category,
    meta.variables,
    referenceImages,
    meta.generatedFolderId ?? null
  );
  return NextResponse.json({ result });
}
