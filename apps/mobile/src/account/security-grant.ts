import { grantFresh } from "./security-flow";

/**
 * "The owner just proved it is them" for the Security screens: set when the current PIN (or fingerprint) was
 * confirmed, spent when the new PIN is saved or the PIN screen closes. In memory only, so a restart, a sign-out of
 * the process, or two minutes (`GRANT_TTL_MS`) without a save all end it.
 */
let grantedAt: number | null = null;

export function grantSecurityChange(now: number = Date.now()): void {
  grantedAt = now;
}
export function securityGrantFresh(now: number = Date.now()): boolean {
  return grantFresh(grantedAt, now);
}
export function clearSecurityGrant(): void {
  grantedAt = null;
}
