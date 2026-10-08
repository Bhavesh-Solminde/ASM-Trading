// nginx on the VPS runs with its default 1MB request-body limit, so every
// upload must land comfortably under it once multipart overhead is added.
const DEFAULT_MAX_BYTES = 900_000;

// Progressively smaller encodes, tried in order until one fits the budget.
const ATTEMPTS: [maxSide: number, quality: number][] = [
  [1600, 0.85],
  [1600, 0.7],
  [1280, 0.7],
  [1024, 0.6],
  [800, 0.55],
];

/**
 * Downsizes a phone photo and re-encodes it as JPEG before upload — a 12MP
 * camera shot drops from ~4MB to a few hundred KB, which matters on mobile
 * data and keeps it under the proxy's body limit. Falls back to the original
 * file whenever the browser can't decode it (the server then validates it).
 */
export async function shrinkImage(file: File, maxBytes = DEFAULT_MAX_BYTES): Promise<Blob> {
  if (!file.type.startsWith("image/")) return file;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return file;
  }
  try {
    let smallest: Blob | null = null;
    for (const [maxSide, quality] of ATTEMPTS) {
      const blob = await encode(bitmap, maxSide, quality);
      if (!blob) continue;
      if (blob.size <= maxBytes) return blob;
      if (!smallest || blob.size < smallest.size) smallest = blob;
    }
    return smallest ?? file;
  } finally {
    bitmap.close();
  }
}

async function encode(bitmap: ImageBitmap, maxSide: number, quality: number): Promise<Blob | null> {
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
}
