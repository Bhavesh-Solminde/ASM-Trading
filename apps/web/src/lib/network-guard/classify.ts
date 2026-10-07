import { BlockList, isIP } from "node:net";

/** What ipapi.is says about an address, collapsed to the decision we make on it. */
export type IpVerdict = "clean" | "relay" | "vpn" | "proxy" | "tor" | "datacenter";

/**
 * "relay" (iCloud Private Relay, Cloudflare WARP, corporate gateways such as
 * Zscaler) is deliberately allowed: those keep the user's real country and are
 * common on ordinary iPhones and office networks. "datacenter" is blocked
 * because a self-hosted VPN on a cloud VM shows up as nothing else.
 */
export const BLOCKED_VERDICTS: ReadonlySet<IpVerdict> = new Set<IpVerdict>([
  "vpn",
  "proxy",
  "tor",
  "datacenter",
]);

const VERDICTS: ReadonlySet<string> = new Set<IpVerdict>([
  "clean",
  "relay",
  "vpn",
  "proxy",
  "tor",
  "datacenter",
]);

export function isIpVerdict(v: string): v is IpVerdict {
  return VERDICTS.has(v);
}

const RELAY_EGRESS = new Set(["private_relay", "secure_web_gateway"]);

/** Returns null when the body is an error or not an ipapi.is lookup at all. */
export function classifyIpapi(body: unknown): IpVerdict | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  if ("error" in b || typeof b.ip !== "string") return null;

  // ipapi.is documents is_vpn as occasionally truthy-but-not-`true`, so every
  // flag is tested for truthiness rather than `=== true`.
  if (b.is_tor) return "tor";
  const egress = b.egress_service;
  if (
    typeof egress === "object" &&
    egress !== null &&
    RELAY_EGRESS.has(String((egress as { type?: unknown }).type))
  ) {
    return "relay";
  }
  if (b.is_vpn) return "vpn";
  if (b.is_proxy) return "proxy";
  if (b.is_datacenter) return "datacenter";
  return "clean";
}

const NON_PUBLIC = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
] as const) {
  NON_PUBLIC.addSubnet(net, prefix, "ipv4");
}
NON_PUBLIC.addAddress("::1", "ipv6");
NON_PUBLIC.addSubnet("fc00::", 7, "ipv6");
NON_PUBLIC.addSubnet("fe80::", 10, "ipv6");

/**
 * Loopback, private, CGNAT and malformed addresses (dev, docker, tests) never
 * reach the provider. They can't be looked up and would only burn quota.
 */
export function isPublicIp(raw: string): boolean {
  const unmapped = raw.startsWith("::ffff:") ? raw.slice(7) : raw;
  const ip = isIP(unmapped) === 4 ? unmapped : raw;
  const family = isIP(ip);
  if (family === 0) return false;
  return !NON_PUBLIC.check(ip, family === 4 ? "ipv4" : "ipv6");
}
