import { NextResponse } from "next/server";
import { deletePoolPhoto, tagPoolPhoto, type PoolPhotoAngle } from "@/services/google-drive";

const VALID_ANGLES = new Set(["front", "side", "worn", "other"]);

/** Sets a pool photo's angle tag — called from the Uploads gallery. */
export async function PATCH(request: Request, { params }: { params: Promise<{ fileId: string }> }) {
  const { fileId } = await params;
  const body = await request.json().catch(() => null);
  const angle = body?.angle;

  if (typeof angle !== "string" || !VALID_ANGLES.has(angle)) {
    return NextResponse.json({ error: "Invalid angle." }, { status: 400 });
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
