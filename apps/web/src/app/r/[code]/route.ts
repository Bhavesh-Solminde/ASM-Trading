import { NextResponse, type NextRequest } from "next/server";
import { resolveTrackedAffiliateLink } from "@asm/db";
import { rememberAffiliateLink } from "@/lib/affiliate-link-visit";
import { appOrigin } from "@/lib/google-oauth";
import { checkRateLimit } from "@/lib/rate-limit";
import { requestContext } from "@/lib/request-context";

const DESTINATION = { HOME: "/", REGISTER: "/register", APP: "/download" } as const;

export async function GET(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const ctx = requestContext(req);
  const origin = appOrigin(req.nextUrl.origin);
  const allowed = await checkRateLimit(`rl:invite:ip:${ctx.ip}`, 30, 300);
  const link = allowed ? await resolveTrackedAffiliateLink((await params).code) : null;
  const response = NextResponse.redirect(new URL(link ? DESTINATION[link.kind] : "/register", origin), 303);
  if (link) await rememberAffiliateLink(response, link.referralCode, link.id, ctx);
  return response;
}
