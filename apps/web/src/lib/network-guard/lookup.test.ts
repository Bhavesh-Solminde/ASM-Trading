import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { redis } from "@/lib/redis";
import { lookupIp, lookupIpDetails, verdictCacheKey } from "./lookup";

const IP = "203.0.113.41";

function fakeFetch(body: unknown, status = 200) {
  return vi.fn<(input: URL, init?: RequestInit) => Promise<Response>>(
    async () => new Response(JSON.stringify(body), { status }),
  );
}

afterEach(async () => {
  await redis.del(verdictCacheKey(IP));
});

afterAll(async () => {
  await redis.quit();
});

describe("lookupIp", () => {
  it("asks ipapi.is about the exact address and caches the verdict for a day", async () => {
    const f = fakeFetch({ ip: IP, is_vpn: true, is_datacenter: true });
    expect(await lookupIp(IP, f as unknown as typeof fetch)).toBe("vpn");

    const url = f.mock.calls[0]![0];
    expect(url.hostname).toBe("api.ipapi.is");
    expect(url.searchParams.get("q")).toBe(IP);

    expect(JSON.parse((await redis.get(verdictCacheKey(IP)))!)).toEqual({ v: "vpn", cc: null });
    const ttl = await redis.ttl(verdictCacheKey(IP));
    expect(ttl).toBeGreaterThan(23 * 3600);
    expect(ttl).toBeLessThanOrEqual(24 * 3600);
  });

  it("keeps the located country alongside the verdict", async () => {
    const f = fakeFetch({ ip: IP, location: { country_code: "in" } });
    expect(await lookupIpDetails(IP, f as unknown as typeof fetch)).toEqual({ verdict: "clean", country: "IN" });
    const again = fakeFetch({});
    expect(await lookupIpDetails(IP, again as unknown as typeof fetch)).toEqual({ verdict: "clean", country: "IN" });
    expect(again).not.toHaveBeenCalled();
  });

  it("still reads a bare-verdict cache entry written before countries were kept", async () => {
    await redis.set(verdictCacheKey(IP), "relay", "EX", 60);
    const f = fakeFetch({});
    expect(await lookupIpDetails(IP, f as unknown as typeof fetch)).toEqual({ verdict: "relay", country: null });
    expect(f).not.toHaveBeenCalled();
  });

  it("serves a cached verdict without calling the provider", async () => {
    await redis.set(verdictCacheKey(IP), "clean", "EX", 60);
    const f = fakeFetch({});
    expect(await lookupIp(IP, f as unknown as typeof fetch)).toBe("clean");
    expect(f).not.toHaveBeenCalled();
  });

  it("returns unknown and remembers it for at most five minutes when the quota is spent", async () => {
    const f = fakeFetch({ error: "quota", error_code: "ERR_QUOTA_EXCEEDED" }, 429);
    expect(await lookupIp(IP, f as unknown as typeof fetch)).toBe("unknown");
    expect(JSON.parse((await redis.get(verdictCacheKey(IP)))!)).toEqual({ v: "unknown", cc: null });
    expect(await redis.ttl(verdictCacheKey(IP))).toBeLessThanOrEqual(300);
  });

  it("returns unknown when the provider is unreachable", async () => {
    const f = vi.fn<(input: URL) => Promise<Response>>(async () => {
      throw new TypeError("fetch failed");
    });
    expect(await lookupIp(IP, f as unknown as typeof fetch)).toBe("unknown");
  });
});
