import { NextResponse } from "next/server";
import { metaPixelIds } from "@/lib/meta-pixel";

/**
 * Pixel IDs for static pages (the landing), which can't read META_PIXEL_ID at
 * request time themselves. Route handlers run per request, so an ID change
 * still needs only a container recreate. IDs are public (they ship in the
 * pixel's own script), so the answer may be cached briefly by the browser.
 */
export function GET() {
  return NextResponse.json(
    { pixelIds: metaPixelIds() },
    { headers: { "Cache-Control": "public, max-age=300" } },
  );
}
