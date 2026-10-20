import { prisma } from "@asm/db";
import { isPublicIp } from "./classify";
import { guardMode } from "./guard";
import { lookupIpDetails, type IpDetails } from "./lookup";

export interface CountryFillDeps {
  enabled(): boolean;
  lookup(ip: string): Promise<IpDetails>;
  /** Writes only when the user has no country yet; true when a row changed. */
  setIfMissing(userId: string, country: string): Promise<boolean>;
}

const defaultDeps: CountryFillDeps = {
  // Reads the guard's in-memory lists, so it is off wherever the guard is
  // (dev, tests and CI never download them).
  enabled: () => guardMode() !== "off",
  lookup: (ip) => lookupIpDetails(ip),
  setIfMissing: async (userId, country) =>
    (await prisma.user.updateMany({ where: { id: userId, country: null }, data: { country } })).count > 0,
};

/**
 * Records where a user signs in from when they haven't said (KYC) yet, so the
 * region-only leaderboard can place them. Never overwrites a stored country
 * and never throws: callers fire and forget it on sign-in.
 */
export async function fillCountryFromIp(
  userId: string,
  ip: string | undefined,
  deps: CountryFillDeps = defaultDeps,
): Promise<string | null> {
  try {
    if (!ip || !deps.enabled() || !isPublicIp(ip)) return null;
    const { country } = await deps.lookup(ip);
    if (!country) return null;
    return (await deps.setIfMissing(userId, country)) ? country : null;
  } catch {
    return null;
  }
}
