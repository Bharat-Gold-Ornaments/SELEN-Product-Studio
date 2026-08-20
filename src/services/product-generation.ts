import "server-only";
import { ensureProductFolders, uploadOriginal, uploadGenerated, type ProductFolders } from "@/services/google-drive";
import { generateAllImages, generateCategoryImages } from "@/services/image-generation";
import type {
  ImagePromptVariables,
  CategoryGenerationResult,
  ReferenceImage,
} from "@/services/leonardo";
import type { ProductType, ImageCategory } from "@/types/product";

export interface OriginalPhoto {
  field: "front" | "side" | "worn";
  mimeType: string;
  buffer: Buffer;
}

/**
 * Turns every uploaded original into an image-to-image reference sent to
 * Leonardo — not just one. v2 models (FLUX Kontext, GPT Image 2) accept
 * several reference images per request, so front/side/worn all go in when
 * they're available, giving the model more than one angle of the real
 * piece to match. Ordered front, then side, then worn — front first since
 * it's the truest straight-on view, in case a model only look at the first
 * few. All three photos are optional, so this may return an empty array;
 * callers fall back to plain text-to-image in that case.
 */
function pickReferenceImages(photos: OriginalPhoto[]): ReferenceImage[] {
  const priority: OriginalPhoto["field"][] = ["front", "side", "worn"];
  return priority
    .map((field) => photos.find((photo) => photo.field === field))
    .filter((photo): photo is OriginalPhoto => Boolean(photo))
    .map((photo) => ({ buffer: photo.buffer, mimeType: photo.mimeType }));
}

export interface DriveUploadOutcome {
  folders: ProductFolders | null;
  error: string | null;
}

async function uploadOriginals(folders: ProductFolders, photos: OriginalPhoto[]): Promise<void> {
  await Promise.all(
    photos.map((photo) =>
      uploadOriginal(folders.originalsFolderId, `${photo.field}.jpg`, photo.buffer, photo.mimeType)
    )
  );
}

/**
 * Creates (or reuses) the product's Drive folder structure and uploads its
 * three original photos. Exposed standalone — not just inside
 * `runInitialGeneration` — so the Review screen's "Retry upload" action can
 * call this exact same step again without re-running Leonardo.
 */
export async function uploadOriginalsToDrive(
  productType: ProductType,
  productId: string,
  photos: OriginalPhoto[]
): Promise<DriveUploadOutcome> {
  try {
    const folders = await ensureProductFolders(productType, productId);
    await uploadOriginals(folders, photos);
    return { folders, error: null };
  } catch (error) {
    return {
      folders: null,
      error: error instanceof Error ? error.message : "Couldn't set up the Drive folder.",
    };
  }
}

export interface GenerationResult {
  productId: string;
  driveFolders: ProductFolders | null;
  driveError: string | null;
  imageResults: CategoryGenerationResult[];
}

/** Downloads whatever Leonardo returned so it can be re-uploaded to Drive. */
async function downloadImage(url: string): Promise<{ buffer: Buffer; mimeType: string }> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Couldn't download generated image (${res.status} ${res.statusText}).`);
  }
  const arrayBuffer = await res.arrayBuffer();
  const mimeType = res.headers.get("content-type") || "image/png";
  return { buffer: Buffer.from(arrayBuffer), mimeType };
}

/**
 * Saves every successfully generated image into the product's Drive
 * `generated` folder, and swaps each result's `imageUrls` from Leonardo's
 * own (short-lived — Leonardo doesn't promise these stay valid long-term)
 * hosting to the resulting Drive public link. This is what actually makes
 * generated images show up in Drive — before this existed, `uploadGenerated`
 * in services/google-drive.ts was defined but never called from anywhere,
 * so nothing was ever saved there.
 *
 * Per-category, non-fatal: if a category's download/upload fails, that
 * category's result quietly falls back to its original Leonardo URLs
 * (still shown fine in Review right now) rather than failing the whole
 * batch — this mirrors the driveError/sheetsError "never block the user"
 * pattern used elsewhere in this flow.
 */
async function saveGeneratedImagesToDrive(
  generatedFolderId: string,
  results: CategoryGenerationResult[]
): Promise<CategoryGenerationResult[]> {
  return Promise.all(
    results.map(async (result) => {
      if (result.status !== "success") return result;
      try {
        const savedUrls = await Promise.all(
          result.imageUrls.map(async (url, index) => {
            const { buffer, mimeType } = await downloadImage(url);
            const extension = (mimeType.split("/")[1] || "png").replace("jpeg", "jpg");
            const fileName =
              result.imageUrls.length > 1
                ? `${result.category}-${index + 1}.${extension}`
                : `${result.category}.${extension}`;
            const { publicUrl } = await uploadGenerated(generatedFolderId, fileName, buffer, mimeType);
            return publicUrl;
          })
        );
        return { ...result, imageUrls: savedUrls };
      } catch (error) {
        console.error(`Failed to save ${result.category} images to Drive:`, error);
        return result;
      }
    })
  );
}

/**
 * Runs Drive setup (folder + original photo upload) and Leonardo image
 * generation concurrently — neither depends on the other's output, so
 * there's no reason to make one wait on the other. If Drive isn't
 * configured or fails, image generation still proceeds; the Review screen
 * surfaces the Drive failure separately with its own retry, so a Drive
 * hiccup never blocks the part of Generate the user is actually waiting to
 * see. Once both finish, generated images are saved into Drive too (see
 * saveGeneratedImagesToDrive) — skipped only if Drive setup itself failed,
 * since there's no folder to save into in that case.
 */
export async function runInitialGeneration(
  productId: string,
  productType: ProductType,
  variables: ImagePromptVariables,
  photos: OriginalPhoto[],
  categories?: ImageCategory[]
): Promise<GenerationResult> {
  const referenceImages = pickReferenceImages(photos);
  const [driveOutcome, rawImageResults] = await Promise.all([
    uploadOriginalsToDrive(productType, productId, photos),
    generateAllImages(productType, variables, referenceImages, categories, productId),
  ]);

  const imageResults = driveOutcome.folders
    ? await saveGeneratedImagesToDrive(driveOutcome.folders.generatedFolderId, rawImageResults)
    : rawImageResults;

  return {
    productId,
    driveFolders: driveOutcome.folders,
    driveError: driveOutcome.error,
    imageResults,
  };
}

/**
 * Regenerates exactly one image category — never touches the others.
 * `referenceImages`, when the caller has any available, are used the same
 * way as the initial generation so a regenerate stays visually consistent
 * with the rest of the set. `generatedFolderId`, when provided (the Review
 * screen sends the one from its session, created during the initial
 * generation), saves the regenerated image into Drive the same way the
 * initial generation does.
 */
export async function regenerateCategory(
  productType: ProductType,
  category: ImageCategory,
  variables: ImagePromptVariables,
  referenceImages?: ReferenceImage[],
  generatedFolderId?: string | null,
  productId?: string
): Promise<CategoryGenerationResult> {
  try {
    const imageUrls = await generateCategoryImages(productType, category, variables, referenceImages, productId);
    const result: CategoryGenerationResult = { category, status: "success", imageUrls };
    if (generatedFolderId) {
      const [saved] = await saveGeneratedImagesToDrive(generatedFolderId, [result]);
      return saved;
    }
    return result;
  } catch (error) {
    return {
      category,
      status: "error",
      message: error instanceof Error ? error.message : "Image generation failed.",
    };
  }
}
