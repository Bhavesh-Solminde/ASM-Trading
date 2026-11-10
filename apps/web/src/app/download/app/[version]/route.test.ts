import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";
import { GET as redirect } from "../route";
let dir = "";
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "apk-"));
  vi.stubEnv("APP_RELEASES_DIR", dir);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});
describe("APK downloads", () => {
  it("streams exact bytes and checksum", async () => {
    await writeFile(
      join(dir, "indianxtrade-1.2.3.apk"),
      Buffer.from([0, 1, 2, 255]),
    );
    const checksum = "a".repeat(64);
    await writeFile(
      join(dir, "indianxtrade-1.2.3.apk.sha256"),
      `${checksum}  app.apk`,
    );
    const r = await GET(new Request("https://x/download/app/1.2.3"), {
      params: Promise.resolve({ version: "1.2.3" }),
    });
    expect(r.status).toBe(200);
    expect(r.headers.get("X-Checksum-Sha256")).toBe(checksum);
    expect([...new Uint8Array(await r.arrayBuffer())]).toEqual([0, 1, 2, 255]);
  });
  it("returns 404 for missing and malformed versions", async () => {
    for (const version of ["1.2.3", "../x"])
      expect(
        (
          await GET(new Request("https://x"), {
            params: Promise.resolve({ version }),
          })
        ).status,
      ).toBe(404);
  });
  it("redirects to the operator's tested latest version", () => {
    vi.stubEnv("APP_LATEST_VERSION", "1.2.3");
    expect(
      redirect(new Request("https://x/download/app")).headers.get("Location"),
    ).toBe("/download/app/1.2.3");
    vi.stubEnv("APP_LATEST_VERSION", "<script>");
    expect(redirect(new Request("https://x/download/app")).status).toBe(404);
  });
});
