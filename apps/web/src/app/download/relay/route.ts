import { NextResponse, type NextRequest } from "next/server";

// Friendly, memorable URL for the relay APK. Next.js serves the raw file
// statically from /downloads/asm-relay.apk (public/downloads/); this route
// only exists so operators can share a shorter link. A 307 preserves the
// request method; the target's URL keeps working if the site origin changes.
export function GET(req: NextRequest): NextResponse {
  return NextResponse.redirect(new URL("/downloads/asm-relay.apk", req.url), 307);
}
