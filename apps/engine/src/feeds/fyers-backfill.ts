import { logger } from "@asm/logger";

/**
 * One-shot historical candle backfill for FYERS indices. Called by a boot
 * hook or an operator script to fill the Candle table for the five indices
 * so the chart has history on the first page load — without this, a brand-
 * new asset shows an empty chart until enough live ticks accumulate.
 *
 * Reference: FYERS v3 /data/history
 *   https://myapi.fyers.in/docsv3
 *
 * The endpoint caps a single request at ~100 bars for intraday resolutions,
 * so the caller passes a range; we return raw OHLCV rows and let the engine
 * decide what to upsert.
 */

const FYERS_HISTORY_URL = "https://api-t1.fyers.in/data/history";

export type FyersResolution = "1" | "2" | "3" | "5" | "10" | "15" | "20" | "30" | "60" | "120" | "240" | "D";

export interface FyersCandle {
  /** Epoch seconds at bar open. */
  ts: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export interface FyersHistoryOptions {
  appId: string;
  accessToken: string;
  /** FYERS symbol, e.g. "NSE:NIFTY50-INDEX". */
  symbol: string;
  resolution: FyersResolution;
  /** Inclusive epoch seconds. */
  rangeFromEpoch: number;
  /** Inclusive epoch seconds. */
  rangeToEpoch: number;
  fetchImpl?: typeof fetch;
}

/**
 * Pure parser for a `/data/history` success body. Separated so the
 * row-shape handling is independently testable against a captured fixture.
 */
export function parseFyersHistory(body: unknown): FyersCandle[] {
  if (!body || typeof body !== "object") return [];
  const obj = body as { s?: string; candles?: unknown };
  if (obj.s !== "ok" || !Array.isArray(obj.candles)) return [];
  const out: FyersCandle[] = [];
  for (const raw of obj.candles) {
    if (!Array.isArray(raw) || raw.length < 5) continue;
    const [ts, o, h, l, c, v] = raw.map((x) => Number(x));
    if (![ts, o, h, l, c].every(Number.isFinite)) continue;
    if (ts! <= 0 || o! <= 0 || h! <= 0 || l! <= 0 || c! <= 0) continue;
    out.push({ ts: Math.floor(ts!), o: o!, h: h!, l: l!, c: c!, v: Number.isFinite(v!) ? v! : 0 });
  }
  return out;
}

export async function fetchFyersHistory(opts: FyersHistoryOptions): Promise<FyersCandle[]> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const url = new URL(FYERS_HISTORY_URL);
  url.searchParams.set("symbol", opts.symbol);
  url.searchParams.set("resolution", opts.resolution);
  url.searchParams.set("date_format", "0");
  url.searchParams.set("range_from", String(opts.rangeFromEpoch));
  url.searchParams.set("range_to", String(opts.rangeToEpoch));
  url.searchParams.set("cont_flag", "1");

  const resp = await fetchImpl(url, {
    headers: { Authorization: `${opts.appId}:${opts.accessToken}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!resp.ok) {
    logger.warn({ evt: "fyers.history_http_error", status: resp.status, symbol: opts.symbol },
      "FYERS /data/history returned non-200");
    return [];
  }
  const body = await resp.json();
  const candles = parseFyersHistory(body);
  logger.info(
    { evt: "fyers.history_fetched", symbol: opts.symbol, resolution: opts.resolution, candles: candles.length },
    "FYERS history fetched",
  );
  return candles;
}
