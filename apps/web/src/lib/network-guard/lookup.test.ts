import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { redis } from "@/lib/redis";
import { IpRangeMap, parseCidr } from "./ip-ranges";
import { EMPTY_INTEL, parseCidrList, type IpIntel } from "./intel";
import { lookupIp, lookupIpapi, lookupIpDetails, verdictCacheKey } from "./lookup";

const IP = "203.0.113.41";
const KEY = "test-key";

function fakeFetch(body: unknown, status = 200) {
  return vi.fn<(input: URL, init?: RequestInit) => Promise<Response>>(
    async () => new Response(JSON.stringify(body), { status }),
  );
}

const INTEL: IpIntel = {
  ...EMPTY_INTEL,
  relay: parseCidrList("172.224.226.0/27,GB,GB-EN,London,\n"),
  datacenter: parseCidrList("198.51.100.0/24\n"),
  country: new IpRangeMap([{ span: parseCidr("203.0.113.0/24")!, value: "IN" }]),
};

afterEach(async () => {
  await redis.del(verdictCacheKey(IP));
});

afterAll(async () => {
  await redis.quit();
});

describe("lookupIpDetails (free lists)", () => {
  it("answers from the in-memory lists without any network call", async () => {
    expect(await lookupIpDetails(IP, { intel: () => INTEL })).toEqual({ verdict: "clean", country: "IN" });
    expect(await lookupIpDetails("172.224.226.9", { intel: () => INTEL })).toEqual({ verdict: "relay", country: null });
    expect(await lookupIp("198.51.100.7", { intel: () => INTEL })).toBe("datacenter");
  });

  it("is unknown (so the guard fails open) before the lists have loaded", async () => {
    expect(await lookupIpDetails(IP, { intel: () => null })).toEqual({ verdict: "unknown", country: null });
    expect(await lookupIp(IP, { intel: () => EMPTY_INTEL })).toBe("unknown");
  });

  it("asks ipapi.is only about addresses the lists call clean, and only when configured", async () => {
    const ipapi = vi.fn(async () => ({ verdict: "vpn" as const, country: "PK" }));
    expect(await lookupIpDetails(IP, { intel: () => INTEL, ipapi })).toEqual({ verdict: "vpn", country: "IN" });
    expect(await lookupIp("198.51.100.7", { intel: () => INTEL, ipapi })).toBe("datacenter");
    expect(ipapi).toHaveBeenCalledTimes(1);
  });

  it("keeps the local verdict when ipapi.is is unavailable", async () => {
    const ipapi = vi.fn(async () => ({ verdict: "unknown" as const, country: null }));
    expect(await lookupIp(IP, { intel: () => INTEL, ipapi })).toBe("clean");
  });
});

describe("lookupIpapi", () => {
  it("asks ipapi.is about the exact address with the key and caches the verdict for a day", async () => {
    const f = fakeFetch({ ip: IP, is_vpn: true, is_datacenter: true });
    expect((await lookupIpapi(IP, KEY, f as unknown as typeof fetch)).verdict).toBe("vpn");

    const url = f.mock.calls[0]![0];
    expect(url.hostname).toBe("api.ipapi.is");
    expect(url.searchParams.get("q")).toBe(IP);
    expect(url.searchParams.get("key")).toBe(KEY);

    expect(JSON.parse((await redis.get(verdictCacheKey(IP)))!)).toEqual({ v: "vpn", cc: null });
    const ttl = await redis.ttl(verdictCacheKey(IP));
    expect(ttl).toBeGreaterThan(23 * 3600);
    expect(ttl).toBeLessThanOrEqual(24 * 3600);
  });

  it("keeps the located country alongside the verdict", async () => {
    const f = fakeFetch({ ip: IP, location: { country_code: "in" } });
    expect(await lookupIpapi(IP, KEY, f as unknown as typeof fetch)).toEqual({ verdict: "clean", country: "IN" });
    const again = fakeFetch({});
    expect(await lookupIpapi(IP, KEY, again as unknown as typeof fetch)).toEqual({ verdict: "clean", country: "IN" });
    expect(again).not.toHaveBeenCalled();
  });

  it("still reads a bare-verdict cache entry written before countries were kept", async () => {
    await redis.set(verdictCacheKey(IP), "relay", "EX", 60);
    const f = fakeFetch({});
    expect(await lookupIpapi(IP, KEY, f as unknown as typeof fetch)).toEqual({ verdict: "relay", country: null });
    expect(f).not.toHaveBeenCalled();
  });

  it("returns unknown and remembers it for at most five minutes when the quota is spent", async () => {
    const f = fakeFetch({ error: "quota", error_code: "ERR_QUOTA_EXCEEDED" }, 429);
    expect((await lookupIpapi(IP, KEY, f as unknown as typeof fetch)).verdict).toBe("unknown");
    expect(JSON.parse((await redis.get(verdictCacheKey(IP)))!)).toEqual({ v: "unknown", cc: null });
    expect(await redis.ttl(verdictCacheKey(IP))).toBeLessThanOrEqual(300);
  });

  it("returns unknown when the provider is unreachable", async () => {
    const f = vi.fn<(input: URL) => Promise<Response>>(async () => {
      throw new TypeError("fetch failed");
    });
    expect((await lookupIpapi(IP, KEY, f as unknown as typeof fetch)).verdict).toBe("unknown");
  });
});
