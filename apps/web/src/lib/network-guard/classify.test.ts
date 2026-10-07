import { describe, expect, it } from "vitest";
import { BLOCKED_VERDICTS, classifyIpapi, isPublicIp } from "./classify";

const base = {
  ip: "203.0.113.7",
  is_mobile: false,
  is_datacenter: false,
  is_tor: false,
  is_proxy: false,
  is_vpn: false,
  is_abuser: false,
};

describe("classifyIpapi", () => {
  it("treats a residential or mobile address as clean", () => {
    expect(classifyIpapi(base)).toBe("clean");
    expect(classifyIpapi({ ...base, is_mobile: true })).toBe("clean");
  });

  it("flags a known VPN exit, including ipapi's truthy non-boolean values", () => {
    expect(classifyIpapi({ ...base, is_vpn: true, is_datacenter: true })).toBe("vpn");
    expect(classifyIpapi({ ...base, is_vpn: "NordVPN" })).toBe("vpn");
  });

  it("flags Tor ahead of every other signal", () => {
    expect(classifyIpapi({ ...base, is_tor: true, is_vpn: true, is_datacenter: true })).toBe("tor");
  });

  it("flags open proxies", () => {
    expect(classifyIpapi({ ...base, is_proxy: true })).toBe("proxy");
  });

  it("flags an unlabelled datacenter address (a self-hosted VPN on a cloud VM)", () => {
    expect(classifyIpapi({ ...base, is_datacenter: true })).toBe("datacenter");
  });

  it("lets iCloud Private Relay through as relay even though it reports is_datacenter", () => {
    const body = {
      ...base,
      is_datacenter: true,
      egress_service: { type: "private_relay", provider: "iCloud Private Relay" },
    };
    expect(classifyIpapi(body)).toBe("relay");
  });

  it("lets corporate secure web gateways through as relay", () => {
    const body = { ...base, egress_service: { type: "secure_web_gateway", provider: "Zscaler" } };
    expect(classifyIpapi(body)).toBe("relay");
  });

  it("returns null for an error body or anything that isn't a lookup", () => {
    expect(
      classifyIpapi({ error: "Invalid IP Address or AS Number", error_code: "ERR_INVALID_IP_OR_ASN" }),
    ).toBeNull();
    expect(classifyIpapi(null)).toBeNull();
    expect(classifyIpapi("nope")).toBeNull();
  });
});

describe("BLOCKED_VERDICTS", () => {
  it("blocks vpn, proxy, tor and datacenter but never clean or relay", () => {
    expect([...BLOCKED_VERDICTS].sort()).toEqual(["datacenter", "proxy", "tor", "vpn"]);
  });
});

describe("isPublicIp", () => {
  it.each(["49.36.1.2", "203.0.113.7", "2405:201:abcd::1"])("%s is public", (ip) => {
    expect(isPublicIp(ip)).toBe(true);
  });

  it.each([
    "local",
    "not-an-ip",
    "127.0.0.1",
    "10.1.2.3",
    "172.18.0.5",
    "192.168.1.9",
    "100.64.0.1",
    "::1",
    "fd00::1",
    "::ffff:127.0.0.1",
  ])("%s is not public", (ip) => {
    expect(isPublicIp(ip)).toBe(false);
  });
});
