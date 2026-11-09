import type { Compressed } from "./compress";
import { uploadErrorText } from "./upload-model";

export type PhotoOutcome =
  | { status: "done"; compressed: Compressed }
  /** `compressed` is kept when the upload failed, so a retry sends the same file; it is null when compression is what failed. */
  | { status: "failed"; message: string; compressed: Compressed | null };

/**
 * Compress a photo and upload it, free of React and native modules. `cached` is the file an earlier try already
 * compressed (a Retry after a failed upload skips the encode). Nothing that fits is "too large, retake" and nothing is
 * uploaded; a compression that throws (an unreadable image, an unknown file size) is a generic error, not "too large".
 * No automatic retry: the screen shows the message and a Retry button.
 */
export async function submitPhoto(deps: {
  cached: Compressed | null;
  compress: () => Promise<Compressed | null>;
  upload: (uri: string) => Promise<void>;
  t: (key: string) => string;
}): Promise<PhotoOutcome> {
  let compressed = deps.cached;
  if (!compressed) {
    try {
      compressed = await deps.compress();
    } catch {
      return { status: "failed", message: deps.t("common.genericError"), compressed: null };
    }
    if (!compressed) return { status: "failed", message: deps.t("kyc.photoTooLarge"), compressed: null };
  }
  try {
    await deps.upload(compressed.uri);
  } catch (e) {
    return { status: "failed", message: uploadErrorText(e, deps.t), compressed };
  }
  return { status: "done", compressed };
}
