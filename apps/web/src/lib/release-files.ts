import { open, realpath } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { constants } from "node:fs";
export const SEMVER = /^\d+\.\d+\.\d+$/;
export const RELEASES_DIR = process.env["APP_RELEASES_DIR"] ?? "/app/releases";
export function apkPath(
  version: string,
  dir: string = process.env["APP_RELEASES_DIR"] ?? "/app/releases",
): string | null {
  return SEMVER.test(version)
    ? resolve(dir, `indianxtrade-${version}.apk`)
    : null;
}
/** Reject symlinks outside the read-only mounted tree; open a descriptor before streaming. */
export async function openContainedFile(root: string, path: string) {
  const [base, actual] = await Promise.all([realpath(root), realpath(path)]);
  if (!actual.startsWith(base + sep)) throw Error("outside file tree");
  const handle = await open(actual, constants.O_RDONLY | constants.O_NOFOLLOW);
  const info = await handle.stat();
  if (!info.isFile()) {
    await handle.close();
    throw Error("not a file");
  }
  return { handle, size: info.size };
}
