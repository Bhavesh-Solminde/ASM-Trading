import { newCorrelationId } from "@asm/logger";
import type { NextRequest } from "next/server";

export interface RequestContext {
  cid: string;
  ip: string;
  userAgent: string;
}

export function requestContext(req: NextRequest): RequestContext {
  return {
    cid: newCorrelationId(),
    ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local",
    userAgent: req.headers.get("user-agent") ?? "unknown",
  };
}
