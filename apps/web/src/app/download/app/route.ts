import { SEMVER } from "@/lib/release-files";
export function GET(req: Request): Response {
  const version = process.env["APP_LATEST_VERSION"]?.trim() ?? "";
  if (new URL(req.url).searchParams.get("help") === "1")
    return new Response(
      `<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Install IndianxTrade</title><body><main><h1>Install IndianxTrade on Android</h1><ol><li>Download the APK from this website.</li><li>Open the download. If Android asks, allow your browser to install this app.</li><li>Install IndianxTrade, then turn off that browser’s “Install unknown apps” permission.</li></ol><p>Keep your existing installation to preserve your app settings. Only install updates signed by the same publisher.</p>${SEMVER.test(version) ? `<p><a href="/download/app/${version}">Download version ${version}</a> · <a href="/download/app/${version}/checksum">SHA-256 checksum</a></p>` : "<p>The app download is not available yet.</p>"}</main></body></html>`,
      {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
        },
      },
    );
  if (!SEMVER.test(version))
    return new Response("The app download is not available yet.", {
      status: 404,
    });
  return new Response(null, {
    status: 307,
    headers: {
      Location: `/download/app/${version}`,
      "Cache-Control": "no-store",
    },
  });
}
