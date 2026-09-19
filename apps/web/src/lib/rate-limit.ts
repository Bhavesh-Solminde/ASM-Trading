import { redis } from "./redis";

/**
 * Fixed-window counter. Returns true when the request is allowed.
 * Fails CLOSED — if Redis is unreachable, auth attempts are refused rather
 * than waved through.
 */
export async function checkRateLimit(
  key: string,
  limit: number,
  windowSec: number,
): Promise<boolean> {
  try {
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, windowSec);
    return count <= limit;
  } catch {
    return false;
  }
}
