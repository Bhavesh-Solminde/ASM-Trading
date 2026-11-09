import { describe, expect, it, vi } from "vitest";
import { KYC_TEMP_DIRS, appOwnedUris, discardFiles, sweepDirs, sweepTargets } from "./temp-files";

const CACHE = "file:///data/user/0/app/cache/";

describe("appOwnedUris", () => {
  it("keeps only files inside the app's cache directory: a gallery original is never ours to delete", () => {
    const out = appOwnedUris(
      [`${CACHE}Camera/a.jpg`, "content://media/external/images/1", "file:///storage/emulated/0/DCIM/IMG_1.jpg", `${CACHE}ImagePicker/b.jpg`],
      CACHE,
    );
    expect(out).toEqual([`${CACHE}Camera/a.jpg`, `${CACHE}ImagePicker/b.jpg`]);
  });
  it("drops nulls, empties, duplicates, the cache directory itself and path traversal out of it", () => {
    const out = appOwnedUris([null, undefined, "", CACHE, `${CACHE}x.jpg`, `${CACHE}x.jpg`, `${CACHE}../files/secret.jpg`], CACHE);
    expect(out).toEqual([`${CACHE}x.jpg`]);
  });
  it("treats a cache URI without a trailing slash the same way, and does not match a sibling directory", () => {
    expect(appOwnedUris([`${CACHE}a.jpg`, "file:///data/user/0/app/cache2/a.jpg"], CACHE.slice(0, -1))).toEqual([`${CACHE}a.jpg`]);
  });
});

describe("discardFiles", () => {
  it("removes every app-owned file and skips the rest", async () => {
    const remove = vi.fn();
    await discardFiles({ uris: [`${CACHE}a.jpg`, "content://x/1", `${CACHE}b.jpg`], cacheUri: CACHE, remove });
    expect(remove.mock.calls.map((c) => c[0])).toEqual([`${CACHE}a.jpg`, `${CACHE}b.jpg`]);
  });
  it("never throws, and a failed delete does not stop the others", async () => {
    const remove = vi.fn(async (uri: string) => {
      if (uri.endsWith("a.jpg")) throw new Error("EBUSY");
    });
    await expect(discardFiles({ uris: [`${CACHE}a.jpg`, `${CACHE}b.jpg`], cacheUri: CACHE, remove })).resolves.toBeUndefined();
    expect(remove).toHaveBeenCalledTimes(2);
  });
  it("does nothing when the cache location is unknown", async () => {
    const remove = vi.fn();
    await discardFiles({ uris: [`${CACHE}a.jpg`], cacheUri: null, remove });
    expect(remove).not.toHaveBeenCalled();
  });
});

describe("sweepTargets / sweepDirs", () => {
  it("names the three cache subfolders the camera, the picker and the manipulator write to", () => {
    expect(KYC_TEMP_DIRS).toEqual(["Camera", "ImagePicker", "ImageManipulator"]);
    expect(sweepTargets(CACHE)).toEqual([`${CACHE}Camera/`, `${CACHE}ImagePicker/`, `${CACHE}ImageManipulator/`]);
    expect(sweepTargets(CACHE.slice(0, -1))).toEqual(sweepTargets(CACHE));
  });
  it("is idempotent and never throws, even when a folder is missing or locked", async () => {
    const removeDir = vi.fn(async (uri: string) => {
      if (uri.includes("ImagePicker")) throw new Error("locked");
    });
    await expect(sweepDirs({ cacheUri: CACHE, removeDir })).resolves.toBeUndefined();
    await expect(sweepDirs({ cacheUri: CACHE, removeDir })).resolves.toBeUndefined();
    expect(removeDir).toHaveBeenCalledTimes(6);
  });
  it("does nothing when the cache location is unknown", async () => {
    const removeDir = vi.fn();
    await sweepDirs({ cacheUri: null, removeDir });
    expect(removeDir).not.toHaveBeenCalled();
  });
});
