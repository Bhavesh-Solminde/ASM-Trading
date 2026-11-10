import { shortCountdown } from "@asm/client-core";

/**
 * The text for an open trade's countdown. Once the expiry has passed but the trade is still open (the engine
 * settles a few seconds after the expiry), a frozen "0:00" reads as a hang, so say it is settling.
 */
export function countdownText(live: { expired: boolean; remainingSec: number }, settling: string): string {
  return live.expired ? settling : shortCountdown(live.remainingSec);
}
