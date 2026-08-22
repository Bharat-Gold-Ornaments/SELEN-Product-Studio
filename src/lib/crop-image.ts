export interface PixelCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new window.Image();
    image.addEventListener("load", () => resolve(image));
    image.addEventListener("error", (err) => reject(err));
    image.src = url;
  });
}

/** Crops `imageSrc` (an object URL) to `pixelCrop` and returns the result as a File with the same name/type as the source. */
export async function getCroppedImageFile(
  imageSrc: string,
  pixelCrop: PixelCrop,
  fileName: string,
  mimeType: string
): Promise<File> {
  const image = await loadImage(imageSrc);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(pixelCrop.width);
  canvas.height = Math.round(pixelCrop.height);

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Couldn't process the cropped image.");

  ctx.drawImage(
    image,
    pixelCrop.x,
    pixelCrop.y,
    pixelCrop.width,
    pixelCrop.height,
    0,
    0,
    canvas.width,
    canvas.height
  );

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, mimeType, 0.92);
  });
  if (!blob) throw new Error("Couldn't process the cropped image.");

  return new File([blob], fileName, { type: mimeType });
}
