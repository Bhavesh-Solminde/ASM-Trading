import { gunzipSync } from "node:zlib";
import { logger } from "@asm/logger";
import type { IpVerdict } from "./classify";
import { IpRangeMap, IpRangeSet, parseCidr, parseIp } from "./ip-ranges";

const X4B = "X4BNet/lists_vpn";
const X4B_FILES = ["vpn/ipv4.txt", "vpn/ipv6.txt", "datacenter/ipv4.txt", "datacenter/ipv6.txt"] as const;
const x4b = (base: string) => X4B_FILES.map((f) => `${base}/output/${f}`);
const [X4B_RAW, X4B_CDN] = [x4b(`https://raw.githubusercontent.com/${X4B}/main`), x4b(`https://cdn.jsdelivr.net/gh/${X4B}@main`)];
const GEO = "https://cdn.jsdelivr.net/npm/@ip-location-db/geo-whois-asn-country/geo-whois-asn-country";

/**
 * Free, keyless public lists the guard checks addresses against locally, so
 * no request ever waits on (or pays) a third-party lookup service. Each source
 * is a list of mirrors, tried in order; each mirror is the files that together
 * make the list.
 *  - relay:      Apple's own iCloud Private Relay egress list
 *  - tor:        the Tor Project's exit-node list
 *  - vpn / datacenter: X4BNet lists_vpn (commercial VPN and hosting ranges)
 *  - country:    ip-location-db geo-whois-asn-country (CC0), else iptoasn.com (public domain)
 */
export const INTEL_SOURCES = {
  relay: [["https://mask-api.icloud.com/egress-ip-ranges.csv"]],
  tor: [["https://check.torproject.org/torbulkexitlist"]],
  vpn: [X4B_RAW.slice(0, 2), X4B_CDN.slice(0, 2)],
  datacenter: [X4B_RAW.slice(2), X4B_CDN.slice(2)],
  country: [
    [`${GEO}-ipv4.csv`, `${GEO}-ipv6.csv`],
    ["https://iptoasn.com/data/ip2country-v4.tsv.gz", "https://iptoasn.com/data/ip2country-v6.tsv.gz"],
  ],
} satisfies Record<string, readonly (readonly string[])[]>;

export type IntelSource = keyof typeof INTEL_SOURCES;

/**
 * Cloudflare WARP / Zero Trust egress, which no downloadable list covers. Fixed
 * by Cloudflare for years; treated like Private Relay.
 */
export const WARP_RANGES = ["104.28.0.0/16", "2a09:bac0::/29"] as const;

export interface IpIntel {
  readonly relay: IpRangeSet | null;
  readonly tor: IpRangeSet | null;
  readonly vpn: IpRangeSet | null;
  readonly datacenter: IpRangeSet | null;
  readonly country: IpRangeMap<string> | null;
}

export const EMPTY_INTEL: IpIntel = { relay: null, tor: null, vpn: null, datacenter: null, country: null };

/**
 * A list a source must at least reach before it replaces the one we hold: a
 * truncated download or an error page must never silently empty a block list.
 */
const MIN_ENTRIES: Record<IntelSource, number> = {
  relay: 1000,
  tor: 100,
  vpn: 1000,
  datacenter: 1000,
  country: 10_000,
};

/** One CIDR or bare address per line; CSV rows use their first column; "#" comments skipped. */
export function parseCidrList(text: string): IpRangeSet {
  const spans = function* () {
    for (const line of text.split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const span = parseCidr(t.split(",")[0]!);
      if (span) yield span;
    }
  };
  return new IpRangeSet(spans());
}

/** "start,end,CC" (ip-location-db) or tab-separated (iptoasn) rows; "None" (unallocated) is skipped. */
export function parseCountryTsv(text: string): IpRangeMap<string> {
  const codes = new Map<string, string>();
  const entries = function* () {
    for (const line of text.split("\n")) {
      const [startRaw, endRaw, ccRaw] = line.split(line.includes("\t") ? "\t" : ",");
      if (!startRaw || !endRaw || !ccRaw) continue;
      const cc = ccRaw.trim().toUpperCase();
      if (!/^[A-Z]{2}$/.test(cc)) continue;
      const start = parseIp(startRaw);
      const end = parseIp(endRaw);
      if (!start || !end || start.family !== end.family) continue;
      // Interned so half a million rows share a couple of hundred strings.
      let code = codes.get(cc);
      if (!code) codes.set(cc, (code = cc));
      const span =
        start.family === 4
          ? { family: 4 as const, start: start.key, end: end.key as number }
          : { family: 6 as const, start: start.key, end: end.key as bigint };
      yield { span, value: code };
    }
  };
  return new IpRangeMap(entries());
}

/**
 * First hit wins, most specific hiding method first: relay and Tor ranges also
 * sit in hosting space. Null when no block list has loaded at all, so a box
 * that couldn't download anything reports "unknown" rather than "clean".
 */
export function classifyLocal(ip: string, intel: IpIntel): IpVerdict | null {
  if (intel.tor?.has(ip)) return "tor";
  if (intel.relay?.has(ip)) return "relay";
  if (intel.vpn?.has(ip)) return "vpn";
  if (intel.datacenter?.has(ip)) return "datacenter";
  return intel.tor || intel.relay || intel.vpn || intel.datacenter ? "clean" : null;
}

const FETCH_TIMEOUT_MS = 60_000;

async function download(url: string, fetchImpl: typeof fetch): Promise<string> {
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), cache: "no-store" });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return url.endsWith(".gz") ? gunzipSync(buf).toString("utf8") : buf.toString("utf8");
}

export interface LoadReport {
  readonly intel: IpIntel;
  readonly loaded: Partial<Record<IntelSource, number>>;
  readonly failed: Partial<Record<IntelSource, string>>;
}

/**
 * Downloads every source; one that fails (or comes back implausibly small)
 * keeps whatever `previous` held for it, so a flaky mirror never drops a list.
 */
export async function loadIntel(previous: IpIntel, fetchImpl: typeof fetch = fetch): Promise<LoadReport> {
  const next: { -readonly [K in keyof IpIntel]: IpIntel[K] } = { ...previous };
  const loaded: Partial<Record<IntelSource, number>> = {};
  const failed: Partial<Record<IntelSource, string>> = {};

  await Promise.all(
    (Object.keys(INTEL_SOURCES) as IntelSource[]).map(async (source) => {
      const errors: string[] = [];
      for (const mirror of INTEL_SOURCES[source]) {
        try {
          const texts = await Promise.all(mirror.map((u) => download(u, fetchImpl)));
          const text = source === "relay" ? [...texts, ...WARP_RANGES].join("\n") : texts.join("\n");
          const table = source === "country" ? parseCountryTsv(text) : parseCidrList(text);
          if (table.size < MIN_ENTRIES[source]) throw new Error(`only ${table.size} entries`);
          if (source === "country") next.country = table as IpRangeMap<string>;
          else next[source] = table as IpRangeSet;
          loaded[source] = table.size;
          return;
        } catch (err) {
          errors.push(String(err));
        }
      }
      failed[source] = errors.join("; ");
    }),
  );
  return { intel: next, loaded, failed };
}

const REFRESH_MS = 24 * 3600_000;
const RETRY_MS = 3600_000;

let current: IpIntel | null = null;
let nextRefreshAt = 0;
let inflight: Promise<void> | null = null;

function refresh(): Promise<void> {
  inflight ??= loadIntel(current ?? EMPTY_INTEL)
    .then(({ intel, loaded, failed }) => {
      current = intel;
      const anyFailed = Object.keys(failed).length > 0;
      nextRefreshAt = Date.now() + (anyFailed ? RETRY_MS : REFRESH_MS);
      if (anyFailed) logger.warn({ evt: "security.ip_intel_partial", loaded, failed }, "ip intel lists partly refreshed");
      else logger.info({ evt: "security.ip_intel_loaded", loaded }, "ip intel lists refreshed");
    })
    .catch((err: unknown) => {
      nextRefreshAt = Date.now() + RETRY_MS;
      logger.error({ evt: "security.ip_intel_failed", err: String(err) }, "ip intel refresh failed");
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/**
 * The lists in memory right now, or null before the first download finishes
 * (callers then fail open). Never waits: a stale snapshot is served while the
 * daily refresh runs in the background.
 */
export function currentIntel(): IpIntel | null {
  if (Date.now() >= nextRefreshAt && !inflight) void refresh();
  return current;
}

/** Starts the first download at server boot so the guard is armed before traffic arrives. */
export function warmIntel(): Promise<void> {
  return current ? Promise.resolve() : (inflight ?? refresh());
}
