import { createVerify, generateKeyPairSync } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  symlink,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildManifest,
  latestUpdateDir,
  multipartBody,
  safeAssetPath,
  signManifest,
} from "./expo-updates";
import { GET } from "../app/api/v1/app/updates/route";
import { GET as getAsset } from "../app/api/v1/app/updates/assets/route";
const dirs: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })),
  );
});
async function root() {
  const d = await mkdtemp(join(tmpdir(), "ota-"));
  dirs.push(d);
  return d;
}
async function exported(root: string, id: string, at: string, ready = true) {
  const dir = join(root, "1.0.0-direct", id);
  await mkdir(join(dir, "_expo/static/js/android"), { recursive: true });
  await mkdir(join(dir, "assets"), { recursive: true });
  await writeFile(join(dir, "_expo/static/js/android/index.hbc"), "BUNDLE");
  await writeFile(join(dir, "assets/icon"), "PNG");
  await writeFile(
    join(dir, "metadata.json"),
    JSON.stringify({
      createdAt: at,
      fileMetadata: {
        android: {
          bundle: "_expo/static/js/android/index.hbc",
          assets: [{ path: "assets/icon", ext: "png" }],
        },
      },
    }),
  );
  await writeFile(
    join(dir, "expoConfig.json"),
    JSON.stringify({
      name: "IndianxTrade",
      slug: "indianxtrade",
      extra: { variant: "direct" },
    }),
  );
  if (ready) await writeFile(join(dir, "READY"), "");
  return dir;
}
const request = (
  runtime = "1.0.0-direct",
  extra: Record<string, string> = {},
) =>
  new Request("https://x/api/v1/app/updates", {
    headers: {
      "expo-protocol-version": "1",
      "expo-platform": "android",
      "expo-runtime-version": runtime,
      accept: "multipart/mixed",
      ...extra,
    },
  });
describe("OTA protocol", () => {
  it("isolates variants and ignores partial uploads", async () => {
    const r = await root();
    const old = await exported(r, "a", "2026-10-20T00:00:00Z");
    await exported(r, "b", "2026-10-21T00:00:00Z", false);
    expect(await latestUpdateDir("1.0.0-direct", r)).toBe(old);
    expect(await latestUpdateDir("1.0.0-play", r)).toBeNull();
    expect(await latestUpdateDir("../1.0.0-direct", r)).toBeNull();
  });
  it("hashes assets, signs exact bytes and includes config in update identity", async () => {
    const r = await root();
    const dir = await exported(r, "a", "2026-10-20T00:00:00Z");
    const options = {
      runtimeVersion: "1.0.0-direct",
      platform: "android" as const,
      assetUrl: (p: string) => `https://x/${p}`,
    };
    const m = await buildManifest(dir, options);
    expect(m.assets[0]).toMatchObject({
      contentType: "image/png",
      fileExtension: ".png",
    });
    expect(m.launchAsset.hash).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(m.id).toMatch(/^[0-9a-f-]{36}$/);
    await writeFile(join(dir, "assets/icon"), "NEW PNG");
    expect((await buildManifest(dir, options)).id).not.toBe(m.id);
    const { privateKey, publicKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
    });
    const body = JSON.stringify(m);
    const sig = /sig="([^"]+)"/.exec(
      signManifest(
        body,
        privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
      ),
    )![1]!;
    const verify = createVerify("RSA-SHA256");
    verify.update(body);
    expect(verify.verify(publicKey, sig, "base64")).toBe(true);
  });
  it("returns no update, refuses unsupported headers and never serves unsigned manifests", async () => {
    const r = await root();
    vi.stubEnv("APP_UPDATES_DIR", r);
    expect((await GET(request())).status).toBe(204);
    expect(
      (await GET(request("1.0.0-direct", { "expo-protocol-version": "2" })))
        .status,
    ).toBe(406);
    expect(
      (await GET(request("1.0.0-direct", { accept: "text/html" }))).status,
    ).toBe(406);
    await exported(r, "a", "2026-10-20T00:00:00Z");
    vi.stubEnv("EXPO_UPDATES_PRIVATE_KEY", "");
    expect((await GET(request())).status).toBe(503);
  });
  it("returns a signed multipart manifest and serves the exact launch bytes", async () => {
    const r = await root();
    vi.stubEnv("APP_UPDATES_DIR", r);
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    vi.stubEnv(
      "EXPO_UPDATES_PRIVATE_KEY",
      privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    );
    await exported(r, "a", "2026-10-20T00:00:00Z");
    const res = await GET(request());
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('name="manifest"');
    expect(text).toContain("expo-signature: sig=");
    const jsonRes = await GET(
      request("1.0.0-direct", { accept: "application/json" }),
    );
    expect(jsonRes.headers.get("Content-Type")).toBe("application/json");
    expect(
      (
        await GET(
          request("1.0.0-direct", { accept: "multipart/mixed;q=0, text/html" }),
        )
      ).status,
    ).toBe(406);
    expect(text).toContain(
      "https://indianxtrade.com/api/v1/app/updates/assets",
    );
    const asset = await getAsset(
      new Request(
        "https://x/api/v1/app/updates/assets?path=1.0.0-direct/a/_expo/static/js/android/index.hbc",
      ),
    );
    expect(await asset.text()).toBe("BUNDLE");
  });
  it("accepts a PEM configured with literal escaped newlines", async () => {
    const r = await root();
    vi.stubEnv("APP_UPDATES_DIR", r);
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    vi.stubEnv("EXPO_UPDATES_PRIVATE_KEY", pem.replace(/\n/g, "\\n"));
    await exported(r, "a", "2026-10-20T00:00:00Z");
    const res = await GET(request());
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("expo-signature: sig=");
  });
  it("rejects traversal, secrets/config reads and filesystem symlinks", async () => {
    const r = await root();
    vi.stubEnv("APP_UPDATES_DIR", r);
    const dir = await exported(r, "a", "2026-10-20T00:00:00Z");
    const outside = await root();
    await writeFile(join(outside, "secret"), "SECRET");
    await symlink(join(outside, "secret"), join(dir, "assets/evil"));
    for (const path of [
      "../../etc/passwd",
      "1.0.0-direct/a/expoConfig.json",
      "1.0.0-direct/a/assets/evil",
    ]) {
      expect(
        (
          await getAsset(
            new Request(
              `https://x/api/v1/app/updates/assets?path=${encodeURIComponent(path)}`,
            ),
          )
        ).status,
      ).toBe(404);
    }
    expect(safeAssetPath(r, "../x")).toBeNull();
    expect(safeAssetPath(r, "/etc/passwd")).toBeNull();
  });
  it("rejects malicious paths in export metadata too", async () => {
    const r = await root();
    const dir = await exported(r, "a", "2026-10-20T00:00:00Z");
    const m = JSON.parse(await readFile(join(dir, "metadata.json"), "utf8"));
    m.fileMetadata.android.bundle = "../../secret";
    await writeFile(join(dir, "metadata.json"), JSON.stringify(m));
    await expect(
      buildManifest(dir, {
        runtimeVersion: "1.0.0-direct",
        platform: "android",
        assetUrl: (p) => p,
      }),
    ).rejects.toThrow();
  });
  it("refuses a Play config published under a direct runtime", async () => {
    const r = await root();
    const dir = await exported(r, "a", "2026-10-20T00:00:00Z");
    await writeFile(
      join(dir, "expoConfig.json"),
      JSON.stringify({ extra: { variant: "play" } }),
    );
    await expect(
      buildManifest(dir, {
        runtimeVersion: "1.0.0-direct",
        platform: "android",
        assetUrl: (p) => p,
      }),
    ).rejects.toThrow("variant/runtime mismatch");
  });
  it("formats protocol boundaries", () => {
    expect(
      multipartBody(
        [{ name: "manifest", contentType: "application/json", body: "{}" }],
        "BOUND",
      ),
    ).toContain("--BOUND\r\ncontent-type: application/json\r\n");
  });
});
