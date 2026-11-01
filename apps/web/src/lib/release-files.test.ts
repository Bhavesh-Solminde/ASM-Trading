import { mkdtemp, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { apkPath, openContainedFile } from "./release-files";
const dirs: string[] = [];
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});
describe("release files", () => {
  it("accepts only complete numeric versions", () => {
    expect(apkPath("1.2.3", "/app/releases")).toBe(
      "/app/releases/indianxtrade-1.2.3.apk",
    );
    for (const v of ["../x", "1.2", "1.2.3/../x", "1.2.3-rc", "1.2.3\n"])
      expect(apkPath(v, "/app/releases")).toBeNull();
  });
  it("rejects symlink escapes", async () => {
    const root = await mkdtemp(join(tmpdir(), "releases-"));
    dirs.push(root);
    const outside = await mkdtemp(join(tmpdir(), "outside-"));
    dirs.push(outside);
    await writeFile(join(outside, "secret"), "secret");
    await symlink(join(outside, "secret"), join(root, "bad.apk"));
    await expect(
      openContainedFile(root, join(root, "bad.apk")),
    ).rejects.toThrow();
  });
});
