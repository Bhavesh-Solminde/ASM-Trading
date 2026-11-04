import { randomUUID } from "node:crypto";
import {
  buildManifest,
  latestUpdateDir,
  multipartBody,
  RUNTIME,
  signManifest,
} from "@/lib/expo-updates";
import { SITE_URL } from "@/lib/site";
export const runtime = "nodejs";
const headers = {
  "expo-protocol-version": "1",
  "expo-sfv-version": "0",
  "expo-manifest-filters": "",
  "expo-server-defined-headers": "",
  "Cache-Control": "private, no-store",
  Vary: "expo-runtime-version, expo-platform, expo-protocol-version, expo-expect-signature, Accept",
};
export async function GET(req: Request) {
  if (req.headers.get("expo-protocol-version") !== "1")
    return new Response("Unsupported protocol", { status: 406, headers });
  const version = req.headers.get("expo-runtime-version") ?? "";
  if (req.headers.get("expo-platform") !== "android" || !RUNTIME.test(version))
    return new Response("Unsupported update request", { status: 400, headers });
  const accept = req.headers.get("accept") ?? "*/*";
  const types = accept
    .split(",")
    .filter((part) => !/;\s*q=0(?:\.0*)?\s*(?:;|$)/i.test(part))
    .map((part) => part.split(";")[0]?.trim());
  const multipart = types.includes("multipart/mixed") || types.includes("*/*");
  const json =
    types.includes("application/json") ||
    types.includes("application/expo+json");
  const jsonType = types.includes("application/expo+json")
    ? "application/expo+json"
    : "application/json";
  if (!multipart && !json) return new Response(null, { status: 406, headers });
  const expected = req.headers.get("expo-expect-signature");
  if (
    expected &&
    ((/keyid="([^"]+)"/.exec(expected)?.[1] ?? "main") !== "main" ||
      (/alg="([^"]+)"/.exec(expected)?.[1] ?? "rsa-v1_5-sha256") !==
        "rsa-v1_5-sha256")
  )
    return new Response("Unsupported signing key", { status: 406, headers });
  const dir = await latestUpdateDir(version);
  if (!dir)
    return new Response(null, { status: multipart ? 204 : 406, headers });
  // Never fall back to unsigned production updates, even for a request which omits expect-signature.
  const key = process.env["EXPO_UPDATES_PRIVATE_KEY"]?.replace(/\\n/g, "\n");
  if (!key)
    return new Response("Updates are not configured", { status: 503, headers });
  try {
    const manifest = await buildManifest(dir, {
      runtimeVersion: version,
      platform: "android",
      assetUrl: (path) =>
        `${SITE_URL}/api/v1/app/updates/assets?path=${encodeURIComponent(path)}`,
    });
    if (req.headers.get("expo-current-update-id") === manifest.id)
      return new Response(null, { status: multipart ? 204 : 406, headers });
    const body = JSON.stringify(manifest);
    const signature = signManifest(body, key);
    if (!multipart)
      return new Response(body, {
        headers: {
          ...headers,
          "Content-Type": jsonType,
          "expo-signature": signature,
        },
      });
    const boundary = `ixt-${randomUUID()}`;
    return new Response(
      multipartBody(
        [
          {
            name: "manifest",
            contentType: "application/json",
            body,
            headers: { "expo-signature": signature },
          },
        ],
        boundary,
      ),
      {
        headers: {
          ...headers,
          "Content-Type": `multipart/mixed; boundary=${boundary}`,
        },
      },
    );
  } catch {
    return new Response("Update unavailable", { status: 503, headers });
  }
}
