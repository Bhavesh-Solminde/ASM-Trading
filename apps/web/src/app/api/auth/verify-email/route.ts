import type { NextRequest } from "next/server";
import { consumeEmailVerificationToken } from "@asm/db";
import { childLogger } from "@asm/logger";
import { requestContext } from "@/lib/request-context";

// Relative Locations stay correct behind the proxy.
function redirect(location: string): Response {
  return new Response(null, { status: 303, headers: { Location: location, "Cache-Control": "no-store" } });
}

export async function GET(req: NextRequest) {
  const ctx = requestContext(req);
  const log = childLogger(ctx.cid);

  // A base64url 32-byte token is 43 characters; the bounds only reject junk.
  const token = req.nextUrl.searchParams.get("token") ?? "";
  const result = token.length >= 32 && token.length <= 128 ? await consumeEmailVerificationToken(token) : null;
  if (!result) {
    log.info({ evt: "auth.email_verify_failed" }, "verification link invalid, used or expired");
    return redirect("/affiliate/dashboard?verify=invalid");
  }
  log.info({ evt: "auth.email_verified", userId: result.userId }, "email verified");
  return redirect("/affiliate/dashboard?verified=1");
}
