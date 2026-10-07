import { redis } from "@/lib/redis";
import { classifyIpapi, isIpVerdict, type IpVerdict } from "./classify";

export type LookupResult = IpVerdict | "unknown";

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

export async function lookupIp(
  ip: string,
  fetchImpl: typeof fetch = fetch,
): Promise<LookupResult> {
  const key = verdictCacheKey(ip);
  const cached = await redis.get(key).catch(() => null);
  if (cached !== null && (cached === "unknown" || isIpVerdict(cached))) return cached;

  const url = new URL("https://api.ipapi.is/");
  url.searchParams.set("q", ip);
  const apiKey = process.env.IPAPI_KEY;
  if (apiKey) url.searchParams.set("key", apiKey);

  let verdict: IpVerdict | null = null;
  try {
    const res = await fetchImpl(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    if (res.ok) verdict = classifyIpapi(await res.json());
  } catch {
    verdict = null;
  }

  const result: LookupResult = verdict ?? "unknown";
  await redis
    .set(key, result, "EX", verdict ? VERDICT_TTL_SEC : UNKNOWN_TTL_SEC)
    .catch(() => {});
  return result;
}
