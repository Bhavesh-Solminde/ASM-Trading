import { newCorrelationId } from "@asm/logger";
import type { NextRequest } from "next/server";

export interface RequestContext {
  cid: string;
  ip: string;
  userAgent: string;
}

/**
 * The caller's address as nginx saw it. nginx sets X-Real-IP to $remote_addr
 * (overwriting anything the client sent) and *appends* the peer to
 * X-Forwarded-For, so the first XFF entry is attacker-controlled and only the
 * last one is trustworthy. Port 3000 is bound to loopback, so nothing but
 * nginx can reach the app in production.
 */
export function clientIpFrom(headers: Pick<Headers, "get">): string {
  const real = headers.get("x-real-ip")?.trim();
  if (real) return real;
  const hops = headers
    .get("x-forwarded-for")
    ?.split(",")
    .map((h) => h.trim())
    .filter(Boolean);
  return hops?.at(-1) ?? "local";
}

export function requestContext(req: NextRequest): RequestContext {
  return {
    cid: newCorrelationId(),
    ip: clientIpFrom(req.headers),
    userAgent: req.headers.get("user-agent") ?? "unknown",
  };
}
