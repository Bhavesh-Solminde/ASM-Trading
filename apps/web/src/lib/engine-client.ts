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
  if (res.status >= 400 && res.status < 500) {
    throw new EngineRejected(res.status, body.error ?? "rejected");
  }
  throw new EngineUnavailable(`engine responded ${res.status}`);
}
