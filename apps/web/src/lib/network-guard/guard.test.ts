import { describe, expect, it, vi } from "vitest";
import type { Logger } from "@asm/logger";
import { VPN_BLOCKED_MESSAGE, checkNetwork, vpnBlockedResponse, type GuardMode } from "./guard";
import type { LookupResult } from "./lookup";

const PUBLIC_IP = "203.0.113.7";

function setup(mode: GuardMode, verdict: LookupResult, exempt = false) {
  const lookup = vi.fn<(ip: string) => Promise<LookupResult>>(async () => verdict);
  const isExempt = vi.fn<(userId: string) => Promise<boolean>>(async () => exempt);
  const log = { warn: vi.fn(), info: vi.fn() };
  const run = (ip = PUBLIC_IP, userId?: string) =>
    checkNetwork(
      { ip, route: "test", log: log as unknown as Logger, userId },
      { mode: () => mode, lookup, isExempt },
    );
  return { lookup, isExempt, log, run };
}

describe("checkNetwork", () => {
  it("does nothing when the mode is off", async () => {
    const t = setup("off", "vpn");
    expect(await t.run()).toEqual({ blocked: false, verdict: "skipped" });
    expect(t.lookup).not.toHaveBeenCalled();
  });

  it.each(["127.0.0.1", "local", "10.0.0.4"])("skips non-public address %s without a lookup", async (ip) => {
    const t = setup("block", "vpn");
    expect(await t.run(ip)).toEqual({ blocked: false, verdict: "skipped" });
    expect(t.lookup).not.toHaveBeenCalled();
  });

  it("allows a clean address", async () => {
    expect(await setup("block", "clean").run()).toEqual({ blocked: false, verdict: "clean" });
  });

  it("allows a privacy relay such as iCloud Private Relay", async () => {
    expect(await setup("block", "relay").run()).toEqual({ blocked: false, verdict: "relay" });
  });

  it.each(["vpn", "proxy", "tor", "datacenter"] as const)("blocks %s in block mode and logs it", async (v) => {
    const t = setup("block", v);
    expect(await t.run()).toEqual({ blocked: true, verdict: v });
    expect(t.log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ evt: "security.vpn_blocked", verdict: v, ip: PUBLIC_IP }),
      expect.any(String),
    );
  });

  it("only logs a VPN in log mode", async () => {
    const t = setup("log", "vpn");
    expect(await t.run()).toEqual({ blocked: false, verdict: "vpn" });
    expect(t.log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ evt: "security.vpn_detected" }),
      expect.any(String),
    );
  });

  it("fails open when the provider couldn't answer", async () => {
    const t = setup("block", "unknown");
    expect(await t.run()).toEqual({ blocked: false, verdict: "unknown" });
    expect(t.log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ evt: "security.vpn_check_unavailable" }),
      expect.any(String),
    );
  });

  it("lets an exempt user through a VPN", async () => {
    const t = setup("block", "vpn", true);
    expect(await t.run(PUBLIC_IP, "user-1")).toEqual({ blocked: false, verdict: "vpn" });
    expect(t.isExempt).toHaveBeenCalledWith("user-1");
  });

  it("never queries exemption for a clean address", async () => {
    const t = setup("block", "clean");
    await t.run(PUBLIC_IP, "user-1");
    expect(t.isExempt).not.toHaveBeenCalled();
  });
});

describe("vpnBlockedResponse", () => {
  it("is a 403 with a stable machine-readable code", async () => {
    const res = vpnBlockedResponse();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: VPN_BLOCKED_MESSAGE, code: "vpn_blocked" });
  });
});
