import { Readable } from "node:stream";
import { extname } from "node:path";
import {
  assetContentType,
  RUNTIME,
  safeAssetPath,
  updatesDir,
} from "@/lib/expo-updates";
import { openContainedFile } from "@/lib/release-files";
export const runtime = "nodejs";
export async function GET(req: Request) {
  const rel = new URL(req.url).searchParams.get("path") ?? "";
  const parts = rel.split("/");
  if (
    !RUNTIME.test(parts[0] ?? "") ||
    !parts[1] ||
    parts[1].startsWith(".") ||
    !(
      parts[2] === "assets" ||
      (parts.length >= 7 &&
        parts.slice(2, 6).join("/") === "_expo/static/js/android")
    )
  )
    return new Response("Not found", { status: 404 });
  const root = updatesDir(),
    full = safeAssetPath(root, rel);
  if (!full) return new Response("Not found", { status: 404 });
  try {
    const { handle, size } = await openContainedFile(root, full);
    return new Response(
      Readable.toWeb(handle.createReadStream()) as ReadableStream,
      {
        headers: {
          "Content-Type": assetContentType(extname(full)),
          "Content-Length": String(size),
          "Cache-Control": "public, max-age=31536000, immutable",
          "X-Content-Type-Options": "nosniff",
        },
      },
    );
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
