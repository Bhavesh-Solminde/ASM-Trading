import { apkPath, openContainedFile } from "@/lib/release-files";
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ version: string }> },
) {
  const { version } = await ctx.params;
  const root = process.env["APP_RELEASES_DIR"] ?? "/app/releases";
  const path = apkPath(version, root);
  if (!path) return new Response("Not found", { status: 404 });
  try {
    const { handle, size } = await openContainedFile(root, `${path}.sha256`);
    try {
      if (size > 1024) throw Error();
      const raw = await handle.readFile("utf8");
      if (!/^[a-f0-9]{64}(?:\s|$)/i.test(raw)) throw Error();
      return new Response(raw, {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "public, max-age=3600",
        },
      });
    } finally {
      await handle.close();
    }
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
