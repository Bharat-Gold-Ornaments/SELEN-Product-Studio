import { NextResponse } from "next/server";
import { downloadFile } from "@/services/google-drive";

/**
 * Streams a Drive file's bytes straight through this app instead of
 * pointing `<img>` tags at any Google-hosted URL directly. This exists
 * because every "public link" format Google offers for embedding
 * (webContentLink, webViewLink, the unofficial lh3.googleusercontent.com/d/
 * pattern) has turned out to be unreliable — Google has progressively
 * broken direct-embed access to Drive files as part of tightening
 * third-party cookie handling, so an <img src> pointed at Google's domain
 * intermittently gets an interstitial or a 403 instead of image bytes.
 * `files.get({ alt: "media" })` (what downloadFile calls) is the official,
 * documented Drive API for reading a file's content and isn't affected by
 * any of that — this route just re-serves those bytes from our own origin.
 * Protected by the same session cookie as the rest of the app (see
 * middleware.ts) since the browser sends it automatically on this
 * same-origin request.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ fileId: string }> }) {
  const { fileId } = await params;

  try {
    const { buffer, mimeType } = await downloadFile(fileId);
    // NextResponse's BodyInit typing wants a plain Uint8Array/ArrayBuffer,
    // not Node's Buffer subtype (TS sees a structural mismatch between
    // Buffer's ArrayBufferLike backing and the DOM lib's ArrayBuffer) — an
    // explicit Uint8Array view over the same bytes satisfies it without a
    // copy.
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": mimeType,
        // Short-lived rather than immutable: a regenerated image reuses
        // the same Drive file id with new content (see uploadFile in
        // services/google-drive.ts), so caching this forever would show a
        // stale photo after a regenerate until the cache expires.
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (error) {
    console.error(`Failed to proxy Drive file ${fileId}`, error);
    return NextResponse.json({ error: "Couldn't load this image." }, { status: 502 });
  }
}
