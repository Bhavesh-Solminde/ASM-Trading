import { gzipSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import {
  EMPTY_INTEL,
  INTEL_SOURCES,
  classifyLocal,
  loadIntel,
  parseCidrList,
  parseCountryTsv,
  type IntelSource,
} from "./intel";

/** n distinct /24s inside 100.0.0.0/8, one per line. */
function cidrs(n: number, prefix = "100"): string {
  return Array.from({ length: n }, (_, i) => `${prefix}.${(i >> 8) & 255}.${i & 255}.0/24`).join("\n");
}

function countryRows(n: number): string {
  return Array.from({ length: n }, (_, i) => `60.${(i >> 8) & 255}.${i & 255}.0\t60.${(i >> 8) & 255}.${i & 255}.255\tIN`).join("\n");
}

const BODIES: Record<IntelSource, string> = {
  relay: cidrs(1200, "17").replace(/\/24/g, "/24,GB,GB-EN,London,"),
  tor: Array.from({ length: 150 }, (_, i) => `185.220.101.${i}`).join("\n"),
  vpn: cidrs(1100, "45"),
  datacenter: cidrs(1100, "100"),
  country: countryRows(11_000),
};

function sourceOf(url: string): { source: IntelSource; mirror: number; first: boolean } {
  for (const source of Object.keys(INTEL_SOURCES) as IntelSource[]) {
    const mirrors: readonly (readonly string[])[] = INTEL_SOURCES[source];
    const mirror = mirrors.findIndex((m) => m.includes(url));
    if (mirror >= 0) return { source, mirror, first: mirrors[mirror]![0] === url };
  }
  throw new Error(`unexpected url ${url}`);
}

/** Serves every list; `down` mirrors (by "source:index") answer 503. */
function fakeFetch(down: ReadonlySet<string> = new Set()) {
  return vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    const { source, mirror, first } = sourceOf(url);
    if (down.has(`${source}:${mirror}`)) return new Response("nope", { status: 503 });
    // Only the first file of a multi-file mirror carries the rows.
    const body = first ? BODIES[source] : "";
    return new Response(url.endsWith(".gz") ? gzipSync(body) : body);
  });
}

describe("parsers", () => {
  it("reads Apple's CSV, bare addresses and comments", () => {
    const set = parseCidrList("# header\n172.224.226.0/27,GB,GB-EN,London,\n\n185.220.101.1\n2a02:26f7::/32,US,,,\n");
    expect(set.has("172.224.226.5")).toBe(true);
    expect(set.has("185.220.101.1")).toBe(true);
    expect(set.has("185.220.101.2")).toBe(false);
    expect(set.has("2a02:26f7:1::1")).toBe(true);
  });

  it("reads ip-location-db and iptoasn rows and skips unallocated (None) space", () => {
    const csv = parseCountryTsv("1.0.0.0,1.0.0.255,AU\n2001:2::,2001:2::ffff:ffff:ffff:ffff:ffff,JP\n");
    expect(csv.get("1.0.0.9")).toBe("AU");
    expect(csv.get("2001:2::5")).toBe("JP");
    const map = parseCountryTsv("1.0.0.0\t1.0.0.255\tUS\n1.0.1.0\t1.0.3.255\tNone\n2405:200::\t2405:207:ffff:ffff:ffff:ffff:ffff:ffff\tIN\n");
    expect(map.get("1.0.0.7")).toBe("US");
    expect(map.get("1.0.2.1")).toBeUndefined();
    expect(map.get("2405:201::1")).toBe("IN");
  });
});

describe("classifyLocal", () => {
  const intel = {
    ...EMPTY_INTEL,
    tor: parseCidrList("185.220.101.1"),
    relay: parseCidrList("104.28.0.0/16"),
    datacenter: parseCidrList("104.16.0.0/12\n185.220.0.0/16"),
  };

  it("names the most specific way the address is hidden", () => {
    expect(classifyLocal("185.220.101.1", intel)).toBe("tor");
    expect(classifyLocal("104.28.3.4", intel)).toBe("relay");
    expect(classifyLocal("104.17.0.1", intel)).toBe("datacenter");
    expect(classifyLocal("49.36.10.10", intel)).toBe("clean");
  });

  it("has no opinion when no block list has loaded", () => {
    expect(classifyLocal("49.36.10.10", { ...EMPTY_INTEL, country: parseCountryTsv("") })).toBeNull();
  });
});

describe("loadIntel", () => {
  it("downloads, unzips and indexes every list", async () => {
    const f = fakeFetch();
    const { intel, failed, loaded } = await loadIntel(EMPTY_INTEL, f as unknown as typeof fetch);
    expect(failed).toEqual({});
    // relay gains the two built-in Cloudflare WARP ranges.
    expect(loaded).toMatchObject({ relay: 1202, tor: 150, vpn: 1100, datacenter: 1100 });
    expect(classifyLocal("17.0.5.9", intel)).toBe("relay");
    expect(classifyLocal("104.28.20.1", intel)).toBe("relay");
    expect(classifyLocal("185.220.101.7", intel)).toBe("tor");
    expect(classifyLocal("45.1.2.3", intel)).toBe("vpn");
    expect(classifyLocal("100.2.3.4", intel)).toBe("datacenter");
    expect(intel.country?.get("60.1.2.3")).toBe("IN");
    // Only the first mirror of each source is needed.
    expect(f).toHaveBeenCalledTimes(Object.values(INTEL_SOURCES).map((m) => m[0]!.length).reduce((a, b) => a + b));
  });

  it("falls back to the next mirror when the first is down", async () => {
    const { intel, failed } = await loadIntel(EMPTY_INTEL, fakeFetch(new Set(["country:0", "vpn:0"])) as unknown as typeof fetch);
    expect(failed).toEqual({});
    expect(intel.country?.get("60.1.2.3")).toBe("IN");
    expect(classifyLocal("45.1.2.3", intel)).toBe("vpn");
  });

  it("keeps the previous list for a source that fails, and refreshes the rest", async () => {
    const first = await loadIntel(EMPTY_INTEL, fakeFetch() as unknown as typeof fetch);
    const second = await loadIntel(first.intel, fakeFetch(new Set(["relay:0"])) as unknown as typeof fetch);
    expect(second.failed.relay).toMatch(/503/);
    expect(second.intel.relay).toBe(first.intel.relay);
    expect(second.intel.vpn).not.toBe(first.intel.vpn);
  });

  it("refuses a suspiciously short list instead of emptying the block", async () => {
    const f = vi.fn(async () => new Response("1.2.3.4\n"));
    const { intel, failed } = await loadIntel(EMPTY_INTEL, f as unknown as typeof fetch);
    expect(failed.tor).toMatch(/only 1 entries/);
    expect(intel.tor).toBeNull();
  });
});
