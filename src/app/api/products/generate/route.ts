import { NextResponse } from "next/server";
import { PRODUCT_SCHEMAS, type ProductFormValues } from "@/lib/product-schemas";
import type { ZodTypeAny } from "zod";
import { buildImagePromptVariables } from "@/lib/generation-variables";
import { buildDraftProductRecord } from "@/lib/product-record";
import { PRODUCT_TYPES } from "@/lib/constants";
import { runInitialGeneration, type OriginalPhoto } from "@/services/product-generation";
import { appendProductRow, updateProductRow } from "@/services/google-sheets";
import { downloadFile, markPoolPhotoUsed } from "@/services/google-drive";
import { IMAGE_CATEGORIES } from "@/lib/constants";
import type { ProductType, ImageCategory } from "@/types/product";

const CATEGORY_LABEL = Object.fromEntries(PRODUCT_TYPES.map((t) => [t.value, t.label])) as Record<
  ProductType,
  string
>;

// Leonardo generation can take a while; see the timeout note in
// services/leonardo.ts for why this is capped where it is.
export const maxDuration = 90;

async function toOriginalPhoto(field: "front" | "side" | "worn", file: File): Promise<OriginalPhoto> {
  return {
    field,
    mimeType: file.type || "image/jpeg",
    buffer: Buffer.from(await file.arrayBuffer()),
  };
}

export async function POST(request: Request) {
  const formData = await request.formData();

  const productId = formData.get("productId");
  const fieldsRaw = formData.get("fields");

  if (typeof productId !== "string" || typeof fieldsRaw !== "string") {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }

  let fields: Record<string, unknown>;
  try {
    fields = JSON.parse(fieldsRaw);
  } catch {
    return NextResponse.json({ error: "Malformed product fields." }, { status: 400 });
  }

  const productType = fields.productType as ProductType;
  // Cast to the generic ZodTypeAny base before calling safeParse: indexing
  // PRODUCT_SCHEMAS with a non-literal `productType` otherwise forces
  // TypeScript to resolve safeParse's return type across all 5 schema
  // variants at once, which is expensive enough to noticeably slow builds.
  const schema = PRODUCT_SCHEMAS[productType] as ZodTypeAny | undefined;
  if (!schema) {
    return NextResponse.json({ error: "Unknown product type." }, { status: 400 });
  }

  const parsed = schema.safeParse({
    ...fields,
    frontPhoto: formData.get("frontPhoto"),
    sidePhoto: formData.get("sidePhoto"),
    wornPhoto: formData.get("wornPhoto"),
  });

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Product details failed validation.", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const values = parsed.data as ProductFormValues;

  // Every photo is optional — only the ones actually provided get uploaded.
  const candidatePhotos: { field: "front" | "side" | "worn"; file: File | null | undefined }[] = [
    { field: "front", file: values.frontPhoto },
    { field: "side", file: values.sidePhoto },
    { field: "worn", file: values.wornPhoto },
  ];
  const providedPhotos = candidatePhotos.filter(
    (entry): entry is { field: "front" | "side" | "worn"; file: File } => entry.file instanceof File
  );

  const localPhotos = await Promise.all(
    providedPhotos.map((entry) => toOriginalPhoto(entry.field, entry.file))
  );

  // Slots filled from the Uploads pool instead of a local file (see
  // dynamic-product-form.tsx) — downloaded straight from Drive so they can
  // be used as image-to-image references the same way a freshly uploaded
  // local file is. A slot with both is defensive-only (the UI keeps them
  // mutually exclusive); the local file wins since it already passed Zod
  // validation above.
  const poolPhotoIds: { front?: string; side?: string; worn?: string } = {};
  const poolPhotoIdsRaw = formData.get("poolPhotoIds");
  if (typeof poolPhotoIdsRaw === "string") {
    try {
      const parsed = JSON.parse(poolPhotoIdsRaw);
      if (parsed && typeof parsed === "object") {
        for (const field of ["front", "side", "worn"] as const) {
          if (typeof parsed[field] === "string" && parsed[field]) poolPhotoIds[field] = parsed[field];
        }
      }
    } catch {
      // Malformed JSON — ignore, no pool photos for this request.
    }
  }
  const localFields = new Set(localPhotos.map((p) => p.field));
  const poolSlotsToFetch = (["front", "side", "worn"] as const).filter(
    (field) => poolPhotoIds[field] && !localFields.has(field)
  );
  const poolPhotos = await Promise.all(
    poolSlotsToFetch.map(async (field): Promise<OriginalPhoto> => {
      const { buffer, mimeType } = await downloadFile(poolPhotoIds[field]!);
      return { field, mimeType, buffer };
    })
  );

  const photos = [...localPhotos, ...poolPhotos];

  const variables = buildImagePromptVariables(values);

  // Which of Hero/Lifestyle/Closeup to actually generate — sent by the
  // Create Product form's checkboxes. Falls back to all of them if missing
  // or malformed, so older clients (or a request with none selected)
  // still generate the full set rather than nothing at all.
  let categories: ImageCategory[] = [...IMAGE_CATEGORIES];
  const categoriesRaw = formData.get("imageCategories");
  if (typeof categoriesRaw === "string") {
    try {
      const parsedCategories = JSON.parse(categoriesRaw);
      if (
        Array.isArray(parsedCategories) &&
        parsedCategories.length > 0 &&
        parsedCategories.every((c): c is ImageCategory => IMAGE_CATEGORIES.includes(c))
      ) {
        categories = parsedCategories;
      }
    } catch {
      // Malformed JSON — keep the "all categories" fallback above.
    }
  }

  // Write the product's Google Sheet row as soon as generation starts, not
  // just once it's eventually published — otherwise nothing shows up in
  // the dashboard or "history" until Milestone 9 (Publish) exists. Runs
  // concurrently with Drive+Leonardo since neither depends on the other;
  // failure here is non-fatal (surfaced via `sheetsError`, same pattern as
  // `driveError`) — a Sheets outage or missing credentials should never
  // block the part of Generate the user is actually waiting on.
  let sheetsError: string | null = null;
  const sheetsWritePromise = appendProductRow(buildDraftProductRecord(productId, values)).catch((error) => {
    sheetsError = error instanceof Error ? error.message : "Couldn't save this product to Google Sheets.";
  });

  try {
    const [result] = await Promise.all([
      runInitialGeneration(productId, productType, variables, photos, categories),
      sheetsWritePromise,
    ]);

    // Non-fatal: a pool photo failing to get marked "used" just means it
    // might show up as pickable again later — annoying, not harmful, and
    // shouldn't fail a request whose actual generation already succeeded.
    await Promise.all(
      poolSlotsToFetch.map((field) =>
        markPoolPhotoUsed(poolPhotoIds[field]!, productId).catch((error) => {
          console.error(`Failed to mark pool photo ${poolPhotoIds[field]} as used`, error);
        })
      )
    );

    // Best-effort follow-up patch with what generation learned — if the
    // initial row write above failed there's nothing to patch, and if this
    // patch itself fails it still shouldn't fail the whole request; the
    // dashboard just shows slightly stale info until the next update.
    if (!sheetsError) {
      const allImagesFailed = result.imageResults.every((r) => r.status === "error");
      try {
        await updateProductRow(productId, {
          driveFolder: result.driveFolders ? `${CATEGORY_LABEL[productType]}/${productId}` : "",
          status: allImagesFailed ? "failed" : "processing",
        });
      } catch (error) {
        sheetsError = error instanceof Error ? error.message : "Couldn't update this product's Sheet row.";
      }
    }

    return NextResponse.json({ ...result, variables, sheetsError });
  } catch (error) {
    console.error("Generate failed", error);
    return NextResponse.json({ error: "Generation failed unexpectedly." }, { status: 500 });
  }
}
