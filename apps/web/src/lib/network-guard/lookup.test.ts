import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { redis } from "@/lib/redis";
import { lookupIp, verdictCacheKey } from "./lookup";

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

    expect(await redis.get(verdictCacheKey(IP))).toBe("vpn");
    const ttl = await redis.ttl(verdictCacheKey(IP));
    expect(ttl).toBeGreaterThan(23 * 3600);
    expect(ttl).toBeLessThanOrEqual(24 * 3600);
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
    expect(await redis.get(verdictCacheKey(IP))).toBe("unknown");
    expect(await redis.ttl(verdictCacheKey(IP))).toBeLessThanOrEqual(300);
  });

  it("returns unknown when the provider is unreachable", async () => {
    const f = vi.fn<(input: URL) => Promise<Response>>(async () => {
      throw new TypeError("fetch failed");
    });
    expect(await lookupIp(IP, f as unknown as typeof fetch)).toBe("unknown");
  });
});
