import { createHash } from "node:crypto";
import type Redis from "ioredis";

/**
 * Must match apps/web/src/lib/ws-ticket.ts. The ticket itself never touches
 * Redis — only its hash — so a Redis dump yields nothing redeemable.
 */
export function ticketKey(ticket: string): string {
  return `ws:ticket:${createHash("sha256").update(ticket).digest("hex")}`;
}

/**
 * Redeems a one-time ticket minted by the web app. GETDEL is atomic, so two
 * sockets racing to redeem the same ticket cannot both succeed.
 */
export function createTicketAuthenticator(
  redis: Redis,
): (ticket: string) => Promise<string | null> {
  return async (ticket) => redis.getdel(ticketKey(ticket));
}
