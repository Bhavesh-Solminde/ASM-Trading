import { SEMVER } from "@/lib/release-files";
export function GET(req: Request): Response {
  if (new URL(req.url).searchParams.get("help") === "1")
    return new Response(null, {
      status: 307,
      headers: { Location: "/download/app/install", "Cache-Control": "no-store" },
    });
  const version = process.env["APP_LATEST_VERSION"]?.trim() ?? "";
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
