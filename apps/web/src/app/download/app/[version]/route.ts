import { Readable } from "node:stream";
import { apkPath, openContainedFile } from "@/lib/release-files";
export const runtime = "nodejs";
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ version: string }> },
) {
  const { version } = await ctx.params;
  const root = process.env["APP_RELEASES_DIR"] ?? "/app/releases";
  const path = apkPath(version, root);
  if (!path) return new Response("Not found", { status: 404 });
  try {
    const { handle, size } = await openContainedFile(root, path);
    let checksum = "";
    try {
      const f = await openContainedFile(root, `${path}.sha256`);
      try {
        if (f.size < 1024) {
          const raw = await f.handle.readFile("utf8");
          checksum = raw.split(/\s+/)[0] ?? "";
        }
      } finally {
        await f.handle.close();
      }
    } catch {
      /* checksum optional for old releases */
    }
    return new Response(
      Readable.toWeb(handle.createReadStream()) as ReadableStream,
      {
        headers: {
          "Content-Type": "application/vnd.android.package-archive",
          "Content-Length": String(size),
          "Content-Disposition": `attachment; filename="indianxtrade-${version}.apk"`,
          "Cache-Control": "public, max-age=3600",
          ...(/^[a-f0-9]{64}$/i.test(checksum)
            ? { "X-Checksum-Sha256": checksum }
            : {}),
        },
      },
    );
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
