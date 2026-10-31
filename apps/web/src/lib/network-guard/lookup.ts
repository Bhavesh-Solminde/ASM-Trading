import { redis } from "@/lib/redis";
import { classifyIpapi, countryFromIpapi, isIpVerdict, type IpVerdict } from "./classify";
import { classifyLocal, currentIntel, type IpIntel } from "./intel";

export type LookupResult = IpVerdict | "unknown";

/** One answer about an address: the verdict plus where it is, when known. */
export interface IpDetails {
  readonly verdict: LookupResult;
  readonly country: string | null;
}

const VERDICT_TTL_SEC = 24 * 3600;
/**
 * A failed lookup is remembered briefly, so an outage or spent quota costs one
 * slow call per IP per window instead of one per request.
 */
const UNKNOWN_TTL_SEC = 300;
const TIMEOUT_MS = 1500;

export function verdictCacheKey(ip: string): string {
  return `vpn:ip:${ip}`;
}

/**
 * Cached as JSON `{"v":verdict,"cc":country}`. Entries written before the
 * country was kept are a bare verdict string; they still read, with no country.
 */
function parseCached(raw: string | null): IpDetails | null {
  if (raw === null) return null;
  if (raw === "unknown" || isIpVerdict(raw)) return { verdict: raw, country: null };
  try {
    const parsed = JSON.parse(raw) as { v?: unknown; cc?: unknown };
    const v = String(parsed.v);
    if (v !== "unknown" && !isIpVerdict(v)) return null;
    return { verdict: v, country: typeof parsed.cc === "string" ? parsed.cc : null };
  } catch {
    return null;
  }
}

/** Asks ipapi.is (paid, optional): only used when IPAPI_KEY is set. */
export async function lookupIpapi(
  ip: string,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<IpDetails> {
  const key = verdictCacheKey(ip);
  const cached = parseCached(await redis.get(key).catch(() => null));
  if (cached) return cached;

  const url = new URL("https://api.ipapi.is/");
  url.searchParams.set("q", ip);
  url.searchParams.set("key", apiKey);

  let verdict: IpVerdict | null = null;
  let country: string | null = null;
  try {
    const res = await fetchImpl(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    if (res.ok) {
      const body: unknown = await res.json();
      verdict = classifyIpapi(body);
      if (verdict) country = countryFromIpapi(body);
    }
  } catch {
    verdict = null;
  }

  const result: IpDetails = { verdict: verdict ?? "unknown", country };
  await redis
    .set(key, JSON.stringify({ v: result.verdict, cc: country }), "EX", verdict ? VERDICT_TTL_SEC : UNKNOWN_TTL_SEC)
    .catch(() => {});
  return result;
}

export interface LookupDeps {
  intel(): IpIntel | null;
  /** The optional paid second opinion; absent when no IPAPI_KEY is configured. */
  ipapi?: (ip: string) => Promise<IpDetails>;
}

function defaultLookupDeps(): LookupDeps {
  const apiKey = process.env.IPAPI_KEY;
  return apiKey ? { intel: currentIntel, ipapi: (ip) => lookupIpapi(ip, apiKey) } : { intel: currentIntel };
}

/**
 * Checks the address against the free public lists held in memory. With an
 * IPAPI_KEY, an address the lists call clean also gets ipapi.is's opinion,
 * which knows a few more VPN ranges; without one, nothing leaves the server.
 */
export async function lookupIpDetails(ip: string, deps: LookupDeps = defaultLookupDeps()): Promise<IpDetails> {
  const intel = deps.intel();
  const local = intel ? classifyLocal(ip, intel) : null;
  const country = intel?.country?.get(ip) ?? null;
  if ((local && local !== "clean") || !deps.ipapi) return { verdict: local ?? "unknown", country };

  const remote = await deps.ipapi(ip);
  return {
    verdict: remote.verdict === "unknown" ? (local ?? "unknown") : remote.verdict,
    country: country ?? remote.country,
  };
}

export async function lookupIp(ip: string, deps?: LookupDeps): Promise<LookupResult> {
  return (await lookupIpDetails(ip, deps)).verdict;
}
