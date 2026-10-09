/**
 * One-shot VPS procedure that:
 *   1. Wipes every row from Trade (TradeShadow cascades).
 *   2. Wipes every row from Candle.
 *   3. Prefills HOURS hours of 1m candles per open asset with the new
 *      medium-persistence (Wick C) price algorithm.
 *
 * The engine MUST be stopped before running this — otherwise its live
 * writes race the wipe + reinsert and the chart ends up with a gap.
 *
 *   docker compose --env-file ../.env.production stop engine
 *   docker compose --env-file ../.env.production run --rm web \
 *     pnpm tsx scripts/wipe-and-prefill-candles.ts
 *   docker compose --env-file ../.env.production start engine
 *
 * Overrides:
 *   HOURS=50          hours of 1m history to produce  (default 50)
 *   KEEP_TRADES=1     skip the Trade wipe             (default: wipe)
 *   SYMBOL=NIFTY50    only backfill that one symbol   (default: every open asset)
 */
import { prisma } from "../packages/db/src/client";
import {
  createRng,
  initPriceState,
  stepPrice,
  TICK_DT_SEC,
  type PriceParams,
} from "../packages/pricing/src/index";

const HOURS = Number(process.env["HOURS"] ?? 50);
const MINUTES = HOURS * 60;
const KEEP_TRADES = process.env["KEEP_TRADES"] === "1";
const SYMBOL_FILTER = process.env["SYMBOL"] || process.argv[2] || null;

interface AssetRow {
  id: string;
  symbol: string;
  basePrice: number;
  precision: number;
  tickSize: number;
  garchOmega: number;
  garchAlpha: number;
  garchBeta: number;
}

function hashSymbol(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

async function backfill(asset: AssetRow, endBucketSec: number) {
  const params: PriceParams = {
    garch: { omega: asset.garchOmega, alpha: asset.garchAlpha, beta: asset.garchBeta },
    driftPerSec: 0,
    anchorAlpha: 0,
    maxTickMove: asset.tickSize * 200,
    // Match the live engine registry — phi = exp(-5/10) ≈ 0.607 per tick
    // (half-life ~7s). ~70% body / ~30% wick.
    trendPersistenceSec: 10,
  };

  const ticksPerMinute = Math.round(60 / TICK_DT_SEC);
  const rng = createRng((Date.now() ^ hashSymbol(asset.symbol)) & 0x7fffffff);
  let state = initPriceState(asset.basePrice, params);
  const startBucketSec = endBucketSec - (MINUTES - 1) * 60;

  const rows: { openTs: Date; o: number; h: number; l: number; c: number }[] = [];
  for (let m = 0; m < MINUTES; m++) {
    const o = state.price;
    let h = o;
    let l = o;
    for (let t = 0; t < ticksPerMinute; t++) {
      state = stepPrice({
        state,
        params,
        dtSec: TICK_DT_SEC,
        z: rng.normal(),
        driftBias: 0,
        magnet: 0,
        anchorTarget: null,
      }).state;
      if (state.price > h) h = state.price;
      if (state.price < l) l = state.price;
    }
    rows.push({
      openTs: new Date((startBucketSec + m * 60) * 1000),
      o: +o.toFixed(asset.precision),
      h: +h.toFixed(asset.precision),
      l: +l.toFixed(asset.precision),
      c: +state.price.toFixed(asset.precision),
    });
  }

  const chunkSize = 500;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    await prisma.candle.createMany({
      data: chunk.map((r) => ({
        assetId: asset.id,
        timeframe: "1m",
        openTs: r.openTs,
        o: r.o,
        h: r.h,
        l: r.l,
        c: r.c,
      })),
      skipDuplicates: true,
    });
  }

  console.log(
    `${asset.symbol.padEnd(16)} ${rows.length} bars  base ${asset.basePrice} → end ${rows.at(-1)?.c}`,
  );
}

async function main() {
  const assets: AssetRow[] = await prisma.asset.findMany({
    where: SYMBOL_FILTER ? { symbol: SYMBOL_FILTER } : { isOpen: true },
    select: {
      id: true,
      symbol: true,
      basePrice: true,
      precision: true,
      tickSize: true,
      garchOmega: true,
      garchAlpha: true,
      garchBeta: true,
    },
  });
  if (assets.length === 0) {
    console.error(
      `No matching assets found${SYMBOL_FILTER ? ` for "${SYMBOL_FILTER}"` : ""}.`,
    );
    process.exit(1);
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const endBucketSec = Math.floor(nowSec / 60) * 60 - 60;

  console.log(
    `=== wipe-and-prefill-candles ===\n` +
      `  assets:     ${assets.length}${SYMBOL_FILTER ? ` (${SYMBOL_FILTER} only)` : ""}\n` +
      `  hours:      ${HOURS}  (${MINUTES} 1m bars per asset)\n` +
      `  trade wipe: ${KEEP_TRADES ? "SKIPPED (KEEP_TRADES=1)" : "YES"}\n` +
      `  ending:     ${new Date(endBucketSec * 1000).toISOString()}\n`,
  );

  if (!KEEP_TRADES) {
    // TradeShadow cascades on delete. HouseTreasury / HouseDay are not touched
    // here — they're global ledgers, not per-trade.
    const trades = await prisma.trade.deleteMany({});
    console.log(`Trade wipe:  deleted ${trades.count} rows (TradeShadow cascaded)`);
  }

  const candles = await prisma.candle.deleteMany({});
  console.log(`Candle wipe: deleted ${candles.count} rows\n`);

  for (const asset of assets) {
    await backfill(asset, endBucketSec);
  }

  console.log(
    `\nDone. Restart the engine so it picks up from the latest prefilled close.`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
