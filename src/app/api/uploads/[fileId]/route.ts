import { NextResponse } from "next/server";
import {
  deletePoolPhoto,
  markPoolPhotoUnused,
  tagPoolPhoto,
  type PoolPhotoAngle,
} from "@/services/google-drive";

const VALID_ANGLES = new Set(["front", "side", "worn", "other"]);

/**
 * Two independent, optional actions on a pool photo, called from the
 * Uploads gallery — send whichever one applies: `{ angle }` to re-tag it, or
 * `{ used: false }` to clear its "used by a product" flag so it shows up as
 * pickable again (the only direction this can go — a photo only ever gets
 * marked used by the Generate flow itself, never by this route).
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ fileId: string }> }) {
  const { fileId } = await params;
  const body = await request.json().catch(() => null);

  if (body && typeof body === "object" && body.used === false) {
    try {
      await markPoolPhotoUnused(fileId);
      return NextResponse.json({ ok: true });
    } catch (error) {
      console.error(`Failed to mark pool photo ${fileId} as unused`, error);
      const message = error instanceof Error ? error.message : "Couldn't update this photo.";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  const angle = body?.angle;
  if (typeof angle !== "string" || !VALID_ANGLES.has(angle)) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  try {
    await tagPoolPhoto(fileId, angle as PoolPhotoAngle);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error(`Failed to tag pool photo ${fileId}`, error);
    const message = error instanceof Error ? error.message : "Couldn't update this photo's tag.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** Removes a photo from the pool — called from the Uploads gallery's delete action. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ fileId: string }> }) {
  const { fileId } = await params;

  try {
    await deletePoolPhoto(fileId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error(`Failed to delete pool photo ${fileId}`, error);
    const message = error instanceof Error ? error.message : "Couldn't delete this photo.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
