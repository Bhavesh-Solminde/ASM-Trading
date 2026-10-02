import type { EngineOpenTradeInput, OpenTradeResult } from "@asm/contracts";

/** The engine refused the trade for a reason the trader can act on. */
export class EngineRejected extends Error {
  constructor(
    readonly status: number,
    readonly reason: string,
  ) {
    super(reason);
    this.name = "EngineRejected";
  }
}

/** Mirrors the engine's DeskRejectionReason (apps/engine/src/trading/errors.ts). */
const TRADER_REFUSALS = new Set([
  "unknown_asset",
  "account_not_found",
  "insufficient_funds",
  "account_not_active",
  "market_closed",
]);

/** The engine could not be reached or failed unexpectedly. */
export class EngineUnavailable extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "EngineUnavailable";
  }
}

/**
 * Opens a trade through the engine's loopback control surface.
 *
 * If the engine accepts the trade but the response is lost (a timeout after it
 * committed), the caller sees EngineUnavailable while the trade exists — the
 * trader's socket still receives trade:opened, which is the source of truth.
 */
export async function engineOpenTrade(input: EngineOpenTradeInput): Promise<OpenTradeResult> {
  const base = process.env["ENGINE_HTTP_URL"] ?? "http://127.0.0.1:4002";
  const secret = process.env["ENGINE_INTERNAL_SECRET"] ?? "";
  if (!secret) throw new EngineUnavailable("ENGINE_INTERNAL_SECRET is not set");

  const res = await fetch(`${base}/trades`, {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(3_000),
    cache: "no-store",
  }).catch(() => null);

  if (!res) throw new EngineUnavailable("engine unreachable");
  if (res.status === 201) return (await res.json()) as OpenTradeResult;

  const body = (await res.json().catch(() => ({}))) as { error?: string };
  // Only the desk's own refusal reasons are ones the trader can act on — keyed
  // by reason, not status, because market_closed arrives as a 503. A 401
  // (secret mismatch), 400 (schema drift) or 413 is our misconfiguration, so it
  // must not reach the browser as "signed out" or "bad input".
  if (body.error && TRADER_REFUSALS.has(body.error)) {
    throw new EngineRejected(res.status, body.error);
  }
  throw new EngineUnavailable(`engine responded ${res.status}`);
}
