import { NextResponse } from "next/server";
import { prisma } from "@asm/db";
import type { Logger } from "@asm/logger";
import { BLOCKED_VERDICTS, isPublicIp } from "./classify";
import { lookupIp, type LookupResult } from "./lookup";

export type GuardMode = "off" | "log" | "block";

/** Off unless explicitly configured, so dev, tests and CI never call the provider. */
export function guardMode(): GuardMode {
  const v = process.env.VPN_BLOCK_MODE;
  return v === "log" || v === "block" ? v : "off";
}

export interface NetworkCheck {
  readonly blocked: boolean;
  readonly verdict: LookupResult | "skipped";
}

export interface GuardDeps {
  mode(): GuardMode;
  lookup(ip: string): Promise<LookupResult>;
  isExempt(userId: string): Promise<boolean>;
}

const defaultDeps: GuardDeps = {
  mode: guardMode,
  lookup: (ip) => lookupIp(ip),
  isExempt: async (userId) =>
    (await prisma.user.findUnique({ where: { id: userId }, select: { vpnExempt: true } }))
      ?.vpnExempt ?? false,
};

/**
 * Decides whether this request's network may use the platform. Fails OPEN: a
 * provider outage or spent quota lets traffic through (logged), because
 * locking every trader out is worse than missing a VPN for five minutes.
 * Exemption is only read for a flagged address, so clean traffic costs no
 * extra DB query.
 */
export async function checkNetwork(
  input: { ip: string; route: string; log: Logger; userId?: string },
  deps: GuardDeps = defaultDeps,
): Promise<NetworkCheck> {
  const mode = deps.mode();
  if (mode === "off" || !isPublicIp(input.ip)) return { blocked: false, verdict: "skipped" };

  const verdict = await deps.lookup(input.ip);
  const fields = { ip: input.ip, verdict, route: input.route, userId: input.userId };

  if (verdict === "unknown") {
    input.log.warn({ evt: "security.vpn_check_unavailable", ...fields }, "vpn check unavailable, allowing");
    return { blocked: false, verdict };
  }
  if (!BLOCKED_VERDICTS.has(verdict)) return { blocked: false, verdict };

  if (input.userId && (await deps.isExempt(input.userId))) {
    input.log.info({ evt: "security.vpn_exempt", ...fields }, "vpn allowed for exempt user");
    return { blocked: false, verdict };
  }
  if (mode === "log") {
    input.log.warn({ evt: "security.vpn_detected", ...fields }, "vpn detected (log mode, allowed)");
    return { blocked: false, verdict };
  }
  input.log.warn({ evt: "security.vpn_blocked", ...fields }, "vpn blocked");
  return { blocked: true, verdict };
}

export const VPN_BLOCKED_MESSAGE = "VPN, proxy or Tor detected. Turn it off and try again.";

export function vpnBlockedResponse(): NextResponse {
  return NextResponse.json({ error: VPN_BLOCKED_MESSAGE, code: "vpn_blocked" }, { status: 403 });
}
