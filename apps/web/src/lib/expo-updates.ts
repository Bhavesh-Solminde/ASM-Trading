import { createHash, createSign } from "node:crypto";
import { readFile, readdir, realpath } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { openContainedFile } from "./release-files";
export const RUNTIME = /^\d+\.\d+\.\d+-(play|direct)$/;
export const updatesDir = () =>
  process.env["APP_UPDATES_DIR"] ?? "/app/updates";
const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  ttf: "font/ttf",
  otf: "font/otf",
  json: "application/json",
  svg: "image/svg+xml",
  hbc: "application/javascript",
  js: "application/javascript",
};
export function assetContentType(ext: string): string {
  return MIME[ext.replace(/^\./, "")] ?? "application/octet-stream";
}
interface Metadata {
  createdAt: string;
  fileMetadata: {
    android: { bundle: string; assets: { path: string; ext: string }[] };
  };
}
export interface ExpoAsset {
  hash: string;
  key: string;
  contentType: string;
  fileExtension?: string;
  url: string;
}
export interface ExpoManifest {
  id: string;
  createdAt: string;
  runtimeVersion: string;
  launchAsset: ExpoAsset;
  assets: ExpoAsset[];
  metadata: Record<string, string>;
  extra: { expoClient: Record<string, unknown> };
}
async function readMeta(dir: string): Promise<Metadata | null> {
  try {
    const m = JSON.parse(
      await readFile(join(dir, "metadata.json"), "utf8"),
    ) as Metadata;
    if (
      !Number.isFinite(Date.parse(m.createdAt)) ||
      typeof m.fileMetadata?.android?.bundle !== "string" ||
      !Array.isArray(m.fileMetadata.android.assets)
    )
      return null;
    return m;
  } catch {
    return null;
  }
}
/** Only complete, atomically published directories are visible to clients. */
export async function latestUpdateDir(
  runtimeVersion: string,
  root: string = updatesDir(),
): Promise<string | null> {
  if (!RUNTIME.test(runtimeVersion)) return null;
  const base = join(root, runtimeVersion);
  try {
    const [actualRoot, actualBase] = await Promise.all([
      realpath(root),
      realpath(base),
    ]);
    if (!actualBase.startsWith(actualRoot + sep)) return null;
  } catch {
    return null;
  }
  let entries;
  try {
    entries = await readdir(base, { withFileTypes: true });
  } catch {
    return null;
  }
  const candidates = await Promise.all(
    entries
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map(async (e) => {
        const dir = join(base, e.name);
        try {
          await readFile(join(dir, "READY"));
          const actual = await realpath(dir);
          if (!actual.startsWith((await realpath(base)) + sep)) return null;
          const m = await readMeta(dir);
          return m ? { dir, at: Date.parse(m.createdAt) } : null;
        } catch {
          return null;
        }
      }),
  );
  return (
    candidates
      .filter((x): x is { dir: string; at: number } => x !== null)
      .sort((a, b) => b.at - a.at || b.dir.localeCompare(a.dir))[0]?.dir ?? null
  );
}
export function safeAssetPath(root: string, rel: string): string | null {
  if (
    !rel ||
    rel.startsWith("/") ||
    rel.includes("\\") ||
    rel.includes("\0") ||
    rel.split("/").some((s) => s === ".." || s === "." || !s)
  )
    return null;
  const full = resolve(root, rel);
  return full.startsWith(resolve(root) + sep) ? full : null;
}
async function asset(
  root: string,
  dir: string,
  path: string,
  ext: string | null,
  url: (p: string) => string,
  launch: boolean,
): Promise<ExpoAsset> {
  const full = safeAssetPath(dir, path);
  if (!full) throw Error("invalid exported asset");
  const f = await openContainedFile(dir, full);
  let data: Buffer;
  try {
    data = await f.handle.readFile();
  } finally {
    await f.handle.close();
  }
  const hash = createHash("sha256").update(data).digest("base64url");
  return {
    hash,
    key: createHash("md5").update(data).digest("hex"),
    contentType: launch
      ? "application/javascript"
      : assetContentType(ext ?? ""),
    ...(ext && !launch ? { fileExtension: `.${ext}` } : {}),
    url: url(relative(root, full).split(sep).join("/")),
  };
}
export async function buildManifest(
  dir: string,
  opts: {
    runtimeVersion: string;
    platform: "android";
    assetUrl: (path: string) => string;
    root?: string;
  },
): Promise<ExpoManifest> {
  if (!RUNTIME.test(opts.runtimeVersion)) throw Error("invalid runtime");
  const root = opts.root ?? resolve(dir, "..", "..");
  const meta = await readMeta(dir);
  if (!meta) throw Error("invalid metadata");
  const pm = meta.fileMetadata.android;
  const [launchAsset, assets, config] = await Promise.all([
    asset(root, dir, pm.bundle, null, opts.assetUrl, true),
    Promise.all(
      pm.assets.map((a) => {
        if (!/^[a-z0-9]+$/i.test(a.ext)) throw Error("invalid asset extension");
        return asset(root, dir, a.path, a.ext, opts.assetUrl, false);
      }),
    ),
    readFile(join(dir, "expoConfig.json"), "utf8"),
  ]);
  const expoClient = JSON.parse(config) as Record<string, unknown>;
  const variant = opts.runtimeVersion.split("-")[1];
  const extra = expoClient["extra"] as { variant?: unknown } | undefined;
  if (
    extra?.variant !== variant ||
    (expoClient["runtimeVersion"] !== undefined &&
      expoClient["runtimeVersion"] !== opts.runtimeVersion)
  )
    throw Error("variant/runtime mismatch");
  const h = createHash("sha256")
    .update(
      JSON.stringify({
        launchAsset,
        assets,
        expoClient,
        createdAt: meta.createdAt,
        runtime: opts.runtimeVersion,
      }),
    )
    .digest("hex");
  const id = `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
  return {
    id,
    createdAt: meta.createdAt,
    runtimeVersion: opts.runtimeVersion,
    launchAsset,
    assets,
    metadata: {},
    extra: { expoClient },
  };
}
export function signManifest(body: string, key: string): string {
  const s = createSign("RSA-SHA256");
  s.update(body);
  return `sig="${s.sign(key, "base64")}", keyid="main"`;
}
export function multipartBody(
  parts: {
    name: string;
    contentType: string;
    body: string;
    headers?: Record<string, string>;
  }[],
  boundary: string,
): string {
  return (
    parts
      .map(
        (p) =>
          `--${boundary}\r\ncontent-type: ${p.contentType}\r\ncontent-disposition: form-data; name="${p.name}"\r\n${Object.entries(
            p.headers ?? {},
          )
            .map(([k, v]) => `${k}: ${v}\r\n`)
            .join("")}\r\n${p.body}\r\n`,
      )
      .join("") + `--${boundary}--\r\n`
  );
}
