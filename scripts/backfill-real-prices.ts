/**
 * Backfill real historical 1m candles from Binance (crypto) and TwelveData
 * (forex + gold) into the Candle table, replacing any existing synthetic
 * candles for the same timestamps.
 *
 * Usage:
 *   DATABASE_URL=... pnpm tsx scripts/backfill-real-prices.ts
 *   DATABASE_URL=... pnpm tsx scripts/backfill-real-prices.ts BTCUSD
 *   HOURS=48 DATABASE_URL=... pnpm tsx scripts/backfill-real-prices.ts
 *
 * Env:
 *   HOURS            — how far back to fetch (default 24, max ~30 days for Binance free)
 *   TWELVE_DATA_API_KEY — required for forex/gold symbols
 *   DATABASE_URL     — postgres connection string
 *
 * On VPS (via deploy scripts/ bind-mount):
 *   cd /opt/asmtrader/deploy && docker compose --env-file ../.env.production \
 *     run --rm -v /opt/asmtrader/scripts:/app/scripts web \
 *     pnpm tsx scripts/backfill-real-prices.ts
 */

import { prisma } from "../packages/db/src/client";

const HOURS = Number(process.env["HOURS"] ?? 24);
const BATCH_SIZE = 50;

// ─── Symbol mappings (same as apps/engine/src/feeds/index.ts) ───────────

const BINANCE_SYMBOLS: Record<string, string> = {
  BTCUSD: "BTCUSDT",
  BTCUSDT: "BTCUSDT",
  ETHUSDT: "ETHUSDT",
  SOLUSDT: "SOLUSDT",
  BNBUSDT: "BNBUSDT",
  XRPUSDT: "XRPUSDT",
  DOGEUSDT: "DOGEUSDT",
};

const TWELVE_DATA_SYMBOLS: Record<string, string> = {
  XAUUSD: "XAU/USD",
  EURUSD: "EUR/USD",
  GBPUSD: "GBP/USD",
  USDJPY: "USD/JPY",
  USDCHF: "USD/CHF",
  AUDUSD: "AUD/USD",
  USDCAD: "USD/CAD",
};

// ─── Binance REST klines ────────────────────────────────────────────────

interface RawKline {
  openTs: number;
  o: number;
  h: number;
  l: number;
  c: number;
}

async function fetchBinanceKlines(
  binanceSymbol: string,
  startMs: number,
  endMs: number,
): Promise<RawKline[]> {
  const all: RawKline[] = [];
  let cursor = startMs;

  while (cursor < endMs) {
    const url = `https://api.binance.com/api/v3/klines?symbol=${binanceSymbol}&interval=1m&startTime=${cursor}&endTime=${endMs}&limit=1000`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`Binance ${binanceSymbol}: HTTP ${res.status}`);

    const rows = (await res.json()) as unknown[][];
    if (rows.length === 0) break;

    for (const r of rows) {
      all.push({
        openTs: Math.floor((r[0] as number) / 1000),
        o: Number(r[1]),
        h: Number(r[2]),
        l: Number(r[3]),
        c: Number(r[4]),
      });
    }

    cursor = (rows.at(-1)![0] as number) + 60_000;
    // Binance rate limit: 1200 weight/min; klines = 2 weight per call
    await sleep(100);
  }

  return all;
}

// ─── TwelveData REST time_series ────────────────────────────────────────

async function fetchTwelveDataKlines(
  tdSymbol: string,
  apiKey: string,
  outputSize: number,
): Promise<RawKline[]> {
  // TwelveData free tier: max outputsize=5000 per call, 8 req/min
  const chunks: RawKline[] = [];
  let remaining = outputSize;
  let endDate: string | undefined;

  while (remaining > 0) {
    const size = Math.min(remaining, 5000);
    let url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(tdSymbol)}&interval=1min&outputsize=${size}&apikey=${encodeURIComponent(apiKey)}`;
    if (endDate) url += `&end_date=${encodeURIComponent(endDate)}`;

    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`TwelveData ${tdSymbol}: HTTP ${res.status}`);

    const body = (await res.json()) as {
      values?: { datetime: string; open: string; high: string; low: string; close: string }[];
      code?: number;
      message?: string;
    };

    if (body.code === 429) {
      console.log(`  TwelveData rate limit — waiting 60s...`);
      await sleep(60_000);
      continue;
    }

    if (!body.values || body.values.length === 0) break;

    for (const v of body.values) {
      const ts = Math.floor(new Date(v.datetime + "Z").getTime() / 1000);
      if (!Number.isFinite(ts)) continue;
      chunks.push({
        openTs: ts,
        o: Number(v.open),
        h: Number(v.high),
        l: Number(v.low),
        c: Number(v.close),
      });
    }

    remaining -= body.values.length;
    if (body.values.length < size) break;

    // Move end_date to just before the oldest returned bar
    const oldest = body.values.at(-1)!;
    const oldestMs = new Date(oldest.datetime + "Z").getTime() - 60_000;
    endDate = new Date(oldestMs).toISOString().replace("T", " ").slice(0, 19);

    // Respect rate limit
    await sleep(8_000);
  }

  return chunks;
}

// ─── DB write ───────────────────────────────────────────────────────────

async function upsertCandles(assetId: string, precision: number, klines: RawKline[]) {
  for (let i = 0; i < klines.length; i += BATCH_SIZE) {
    const chunk = klines.slice(i, i + BATCH_SIZE);
    await prisma.$transaction(
      chunk.map((k) =>
        prisma.candle.upsert({
          where: {
            assetId_timeframe_openTs: {
              assetId,
              timeframe: "1m",
              openTs: new Date(k.openTs * 1000),
            },
          },
          create: {
            assetId,
            timeframe: "1m",
            openTs: new Date(k.openTs * 1000),
            o: +k.o.toFixed(precision),
            h: +k.h.toFixed(precision),
            l: +k.l.toFixed(precision),
            c: +k.c.toFixed(precision),
          },
          update: {
            o: +k.o.toFixed(precision),
            h: +k.h.toFixed(precision),
            l: +k.l.toFixed(precision),
            c: +k.c.toFixed(precision),
          },
        }),
      ),
    );
  }
}

// ─── Main ───────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const symbolFilter = process.argv[2];
  const tdApiKey = process.env["TWELVE_DATA_API_KEY"];

  const assets = await prisma.asset.findMany({
    where: symbolFilter ? { symbol: symbolFilter } : { isOpen: true },
    select: { id: true, symbol: true, precision: true },
  });

  if (assets.length === 0) {
    console.error(`No matching assets${symbolFilter ? ` for "${symbolFilter}"` : ""}.`);
    process.exit(1);
  }

  const nowMs = Date.now();
  const startMs = nowMs - HOURS * 60 * 60 * 1000;
  const barsExpected = HOURS * 60;

  console.log(
    `Backfilling ${HOURS}h of REAL prices for ${assets.length} asset(s)\n` +
      `  from ${new Date(startMs).toISOString()} to ${new Date(nowMs).toISOString()}\n`,
  );

  for (const asset of assets) {
    const binanceRemote = BINANCE_SYMBOLS[asset.symbol];
    const tdRemote = TWELVE_DATA_SYMBOLS[asset.symbol];

    if (binanceRemote) {
      try {
        console.log(`${asset.symbol.padEnd(12)} fetching from Binance (${binanceRemote})...`);
        const klines = await fetchBinanceKlines(binanceRemote, startMs, nowMs);
        console.log(`${asset.symbol.padEnd(12)} got ${klines.length} bars, writing...`);
        await upsertCandles(asset.id, asset.precision, klines);
        console.log(`${asset.symbol.padEnd(12)} done (${klines.length}/${barsExpected} bars)\n`);
      } catch (err) {
        console.error(`${asset.symbol.padEnd(12)} FAILED: ${err instanceof Error ? err.message : err}\n`);
      }
    } else if (tdRemote) {
      if (!tdApiKey) {
        console.log(`${asset.symbol.padEnd(12)} SKIP — TWELVE_DATA_API_KEY not set\n`);
        continue;
      }
      try {
        console.log(`${asset.symbol.padEnd(12)} fetching from TwelveData (${tdRemote})...`);
        const klines = await fetchTwelveDataKlines(tdRemote, tdApiKey, barsExpected);
        console.log(`${asset.symbol.padEnd(12)} got ${klines.length} bars, writing...`);
        await upsertCandles(asset.id, asset.precision, klines);
        console.log(`${asset.symbol.padEnd(12)} done (${klines.length}/${barsExpected} bars)\n`);
      } catch (err) {
        console.error(`${asset.symbol.padEnd(12)} FAILED: ${err instanceof Error ? err.message : err}\n`);
      }
    } else {
      console.log(`${asset.symbol.padEnd(12)} SKIP — no real-price source\n`);
    }
  }

  console.log("Backfill complete.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
