/**
 * Reads pixel dimensions straight out of a JPEG or PNG's own header bytes —
 * no image-decoding dependency needed since both formats put width/height
 * in a small, fixed/predictable spot near the start of the file. Used by
 * the Review screen's manual photo upload (api/products/[productId]/
 * upload-image/route.ts) to enforce "square images only" server-side,
 * never trusting the client-side check alone since this is a real upload
 * boundary. Returns null for anything that doesn't parse as a well-formed
 * JPEG/PNG rather than throwing — the caller treats that as "couldn't
 * validate this image" and rejects the upload.
 */
export function readImageDimensions(buffer: Buffer, mimeType: string): { width: number; height: number } | null {
  if (mimeType === "image/png") return pngDimensions(buffer);
  if (mimeType === "image/jpeg") return jpegDimensions(buffer);
  return null;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// PNG's first chunk is always a 25-byte IHDR: 8-byte signature, 4-byte chunk
// length, 4-byte "IHDR" tag, then width/height as two big-endian uint32s.
// https://www.w3.org/TR/png/#11IHDR
function pngDimensions(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

// JPEG is a sequence of marker segments (0xFF followed by a marker byte).
// Dimensions live in whichever "start of frame" marker (0xC0-0xCF, except
// the DHT/JPG/DAC markers 0xC4/0xC8/0xCC) appears first — everything else is
// skipped over using each segment's own declared length.
// https://www.w3.org/Graphics/JPEG/itu-t81.pdf, Annex B.
function jpegDimensions(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;

  let offset = 2;
  while (offset + 1 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset++;
      continue;
    }
    const marker = buffer[offset + 1];
    if (marker === 0xff) {
      offset++; // Fill byte before the real marker.
      continue;
    }
    // Markers with no following length field.
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    if (offset + 4 > buffer.length) return null;
    const segmentLength = buffer.readUInt16BE(offset + 2);

    const isStartOfFrame =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);
    if (isStartOfFrame) {
      if (offset + 9 > buffer.length) return null;
      // SOF layout after the length field: 1-byte precision, 2-byte height, 2-byte width.
      return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
    }

    offset += 2 + segmentLength;
  }
  return null;
}
