/** nginx on the VPS has a 1 MB request-body limit; multipart overhead rides on top of the photo. */
export const MAX_BYTES = 900_000;

/**
 * Progressively smaller encodes, tried in order until one fits. Mirrors `ATTEMPTS` in
 * apps/web/src/lib/shrink-image.ts so a photo from the app and from the web end up the same size.
 */
export const ATTEMPTS: ReadonlyArray<readonly [maxSide: number, quality: number]> = [
  [1600, 0.85],
  [1600, 0.7],
  [1280, 0.7],
  [1024, 0.6],
  [800, 0.55],
];

export interface Compressed {
  uri: string;
  bytes: number;
}

/**
 * The first encode that is non-empty and at most `MAX_BYTES`, else null. There is no "smallest attempt" fallback
 * (the web has one): the app tells the user to retake the photo and never uploads something the proxy would refuse.
 * An encode that throws is the caller's to handle.
 */
export async function compressWith(run: (maxSide: number, quality: number) => Promise<Compressed>): Promise<Compressed | null> {
  for (const [maxSide, quality] of ATTEMPTS) {
    const out = await run(maxSide, quality);
    if (out.bytes > 0 && out.bytes <= MAX_BYTES) return out;
  }
  return null;
}

/**
 * The resize that caps an image's long side at `maxSide` and keeps its ratio (the manipulator derives the other
 * side). Never enlarges: a photo already smaller than the cap keeps its own size.
 */
export function fitResize(width: number, height: number, maxSide: number): { width: number } | { height: number } {
  return width >= height ? { width: Math.min(width, maxSide) } : { height: Math.min(height, maxSide) };
}
