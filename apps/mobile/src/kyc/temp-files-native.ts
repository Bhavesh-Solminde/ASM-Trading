import { Directory, File, Paths } from "expo-file-system";
import { discardFiles, sweepDirs } from "./temp-files";

/** The app cache's URI, or null when the platform cannot say (then nothing is deleted). */
function cacheUri(): string | null {
  try {
    return Paths.cache.uri;
  } catch {
    return null;
  }
}

/**
 * Deletes the given KYC photo files that live in the app's cache. A gallery original (a URI outside the cache) is left
 * alone. Never throws. The logic and its tests are in `temp-files.ts`; this only drives expo-file-system.
 */
export function discardKycFiles(uris: ReadonlyArray<string | null | undefined>): Promise<void> {
  return discardFiles({
    uris,
    cacheUri: cacheUri(),
    remove: (uri) => {
      const file = new File(uri);
      if (file.exists) file.delete();
    },
  });
}

/** Sign-out sweep: empties the camera, picker and manipulator cache folders. Idempotent; never throws. */
export function sweepKycTemp(): Promise<void> {
  return sweepDirs({
    cacheUri: cacheUri(),
    removeDir: (uri) => {
      const dir = new Directory(uri);
      if (dir.exists) dir.delete();
    },
  });
}
