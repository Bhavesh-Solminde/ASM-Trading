/**
 * Which KYC photo files the app must delete, free of native modules. A photo of an ID document must not outlive the
 * moment it is uploaded (or abandoned): the camera, the gallery picker and the image manipulator all write a copy
 * into the app's cache, and nothing else ever clears it. Only files inside the app's own cache are ever deleted: a
 * `content://` URI or a path outside it is the user's gallery original, which the picker did not copy and we must not touch.
 */

/** The cache subfolders expo-camera, expo-image-picker and expo-image-manipulator write to (all recreated on demand). */
export const KYC_TEMP_DIRS = ["Camera", "ImagePicker", "ImageManipulator"] as const;

const withSlash = (uri: string) => (uri.endsWith("/") ? uri : `${uri}/`);

/** The given URIs that are files inside `cacheUri`, once each, in order. Null, empty, the cache folder itself and `..` escapes are dropped. */
export function appOwnedUris(uris: ReadonlyArray<string | null | undefined>, cacheUri: string): string[] {
  const root = withSlash(cacheUri);
  const out: string[] = [];
  for (const uri of uris) {
    if (!uri || uri.length <= root.length || !uri.startsWith(root)) continue;
    if (uri.slice(root.length).split("/").includes("..")) continue;
    if (!out.includes(uri)) out.push(uri);
  }
  return out;
}

/** Deletes each app-owned file among `uris`. Best effort: a failed delete is swallowed and never stops the next one. */
export async function discardFiles(deps: {
  uris: ReadonlyArray<string | null | undefined>;
  cacheUri: string | null;
  remove: (uri: string) => void | Promise<void>;
}): Promise<void> {
  if (!deps.cacheUri) return;
  for (const uri of appOwnedUris(deps.uris, deps.cacheUri)) {
    try {
      await deps.remove(uri);
    } catch {
      // A file that cannot be deleted now is swept at the next sign-out; it must never block the flow.
    }
  }
}

/** The folders a sign-out sweeps, as directory URIs with a trailing slash. */
export function sweepTargets(cacheUri: string): string[] {
  const root = withSlash(cacheUri);
  return KYC_TEMP_DIRS.map((name) => `${root}${name}/`);
}

/** Deletes the KYC temp folders. Idempotent (a missing folder is the caller's no-op) and never throws. */
export async function sweepDirs(deps: { cacheUri: string | null; removeDir: (uri: string) => void | Promise<void> }): Promise<void> {
  if (!deps.cacheUri) return;
  for (const uri of sweepTargets(deps.cacheUri)) {
    try {
      await deps.removeDir(uri);
    } catch {
      // Best effort: sign-out must complete whatever the disk says.
    }
  }
}
