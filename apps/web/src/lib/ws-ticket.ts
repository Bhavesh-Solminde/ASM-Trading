import { createHash, randomBytes } from "node:crypto";
import { redis } from "./redis";

export const WS_TICKET_TTL_SEC = 30;

/** Must match apps/engine/src/auth/ws-ticket.ts — both sides derive the same key. */
export function wsTicketKey(ticket: string): string {
  return `ws:ticket:${createHash("sha256").update(ticket).digest("hex")}`;
}

/** Mints a single-use ticket that lets exactly one socket authenticate as this user. */
export async function issueWsTicket(userId: string): Promise<string> {
  const ticket = randomBytes(32).toString("base64url");
  await redis.set(wsTicketKey(ticket), userId, "EX", WS_TICKET_TTL_SEC);
  return ticket;
}
