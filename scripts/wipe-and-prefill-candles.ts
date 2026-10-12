/**
 * One-shot VPS procedure that rebuilds every chart from scratch:
 *   1. Refunds every OPEN trade (both account types).
 *   2. Deletes trade history — demo accounts only by default.
 *   3. Resets the per-account counters derived from the deleted trades.
 *   4. Wipes every row from Candle.
 *   5. Prefills HOURS hours of 1m candles per open asset at the asset's
 *      current `precision`.
 *
 * DRY RUN BY DEFAULT. It reports exactly what it would touch and changes
 * nothing until you pass APPLY=1.
 *
 * Why step 1 is not optional: wiping candles replaces the price path an open
 * trade was entered against, and the backfill restarts each asset from its
 * basePrice rather than its last close. An open trade left in place would
 * settle against an unrelated path — a win or a loss decided by the rebuild
 * rather than by the market. `voidTrade` records each one REFUNDED with no
 * exit price and credits the stake back on the same real/bonus split it was
 * taken on, so no balance moves on net.
 *
 * Why step 3 matters: tradesCount / rollingWinRate / streaks /
 * turnoverProgress / medianStake are stored on Account, not derived. Left
 * alone after a wipe they describe trades that no longer exist, and the
 * algo keeps steering from them.
 *
 * NOT touched: HouseDay, HouseTreasury and ShadowTick keep their totals, and
 * Transaction rows for deleted trades keep their refType/refId. Both are
 * deliberate — the ledger stays append-only and the house P&L history stays
 * continuous. Pass RESET_HOUSE=1 only if you want the house aggregates
 * zeroed as well.
 *
 * The engine MUST be stopped before running this — otherwise its live
 * writes race the wipe + reinsert and the chart ends up with a gap.
 *
 * `tsx` is a devDependency of @asm/db and is not on the root bin path in the
 * production image, so it has to be invoked through that workspace — the same
 * form the seed command uses. Plain `pnpm tsx scripts/...` fails with
 * "Command tsx not found".
 *
 * The production image ships apps/ and packages/ but NOT scripts/, so the
 * host copy has to be bind-mounted in. And env vars go inside `sh -c`:
 * `docker compose run` treats a leading VAR=x as part of the service name.
 *
 *   docker compose --env-file ../.env.production stop engine
 *   docker compose --env-file ../.env.production run --rm \
 *     -v /opt/asmtrader/scripts:/app/scripts web \
 *     sh -c 'TRADES=none pnpm --filter @asm/db exec tsx ../../scripts/wipe-and-prefill-candles.ts'
 *   docker compose --env-file ../.env.production run --rm \
 *     -v /opt/asmtrader/scripts:/app/scripts web \
 *     sh -c 'APPLY=1 TRADES=none pnpm --filter @asm/db exec tsx ../../scripts/wipe-and-prefill-candles.ts'
 *   docker compose --env-file ../.env.production start engine
 *
 * The engine stays stopped for the whole sequence. If any step fails, START
 * THE ENGINE AGAIN before debugging — a failed run leaves it down and the
 * live charts frozen.
 *
 * Overrides:
 *   APPLY=1           actually write    (default: dry run, no writes)
 *   HOURS=50          hours of 1m history to produce  (default 50)
 *   TRADES=demo       delete demo-account trades only (default)
 *   TRADES=all        delete every trade, real money included
 *   TRADES=none       keep all trade rows; open trades are still refunded
 *   RESET_HOUSE=1     also zero HouseDay / HouseTreasury / ShadowTick
 *   SYMBOL=NIFTY50    only backfill that one symbol   (default: every open asset)
 */
import { prisma } from "../packages/db/src/client";
import { voidTrade } from "../packages/db/src/repositories/trade";
import {
  INTRADAY_PROFILES,
  MARKET_NEWS,
  createRng,
  initMsm,
  initPriceState,
  intradayFactor,
  marketMsm,
  msmMultiplier,
  stepMsm,
  stepPrice,
  TICK_DT_SEC,
  type IntradayProfileName,
  type PriceParams,
} from "../packages/pricing/src/index";

const HOURS = Number(process.env["HOURS"] ?? 50);
const MINUTES = HOURS * 60;
const APPLY = process.env["APPLY"] === "1";
const RESET_HOUSE = process.env["RESET_HOUSE"] === "1";

const TRADES = (process.env["TRADES"] ?? "demo").toLowerCase();
if (!["demo", "all", "none"].includes(TRADES)) {
  console.error(`TRADES must be one of demo | all | none, received "${TRADES}"`);
  process.exit(1);
}

/**
 * The counter values a fresh account carries. Mirrors the defaults on
 * Account in schema.prisma; `medianStake` defaults to 100 paise there, not 0.
 */
const FRESH_COUNTERS = {
  tradesCount: 0,
  rollingWinRate: 0,
  medianStake: 100,
  lossStreak: 0,
  winStreak: 0,
  turnoverProgress: 0,
} as const;
const SYMBOL_FILTER = process.env["SYMBOL"] || process.argv[2] || null;

interface AssetRow {
  id: string;
  symbol: string;
  basePrice: number;
  precision: number;
  tickSize: number;
  msmSigma: number;
  msmM0: number;
  intradayProfile: IntradayProfileName;
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
  const intraday = INTRADAY_PROFILES[asset.intradayProfile];
  const params: PriceParams = {
    msm: marketMsm(asset.msmSigma, asset.msmM0),
    intraday,
    news: MARKET_NEWS,
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
  let vol = initMsm(params.msm, rng.next);
  const startBucketSec = endBucketSec - (MINUTES - 1) * 60;

  const rows: { openTs: Date; o: number; h: number; l: number; c: number }[] = [];
  for (let m = 0; m < MINUTES; m++) {
    const o = state.price;
    let h = o;
    let l = o;
    for (let t = 0; t < ticksPerMinute; t++) {
      vol = stepMsm(vol, params.msm, TICK_DT_SEC, rng.next);
      const tickSec = startBucketSec + m * 60 + t * TICK_DT_SEC;
      const volScale = msmMultiplier(vol, params.msm) * intradayFactor(intraday, tickSec);
      state = stepPrice({
        state,
        params,
        dtSec: TICK_DT_SEC,
        z: rng.normal(),
        volScale,
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
      msmSigma: true,
      msmM0: true,
      intradayProfile: true,
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

  // Survey first, and print it whether or not we are going to write. On a dry
  // run this is the whole output; on a real run it is the record of what the
  // database looked like immediately before it changed.
  const demoAccountIds = (
    await prisma.account.findMany({ where: { type: "DEMO" }, select: { id: true } })
  ).map((a) => a.id);
  const deleteWhere =
    TRADES === "all" ? {} : { accountId: { in: demoAccountIds } };

  const [openAll, openReal, tradesToDelete, candleCount] = await Promise.all([
    prisma.trade.count({ where: { status: "OPEN" } }),
    prisma.trade.count({
      where: { status: "OPEN", account: { type: { not: "DEMO" } } },
    }),
    TRADES === "none" ? Promise.resolve(0) : prisma.trade.count({ where: deleteWhere }),
    prisma.candle.count(),
  ]);
  const openStake = await prisma.trade.aggregate({
    where: { status: "OPEN" },
    _sum: { stake: true },
  });

  console.log(
    `=== wipe-and-prefill-candles ===\n` +
      `  mode:        ${APPLY ? "APPLY — writing to the database" : "DRY RUN — no writes (pass APPLY=1 to execute)"}\n` +
      `  assets:      ${assets.length}${SYMBOL_FILTER ? ` (${SYMBOL_FILTER} only)` : ""}\n` +
      `  hours:       ${HOURS}  (${MINUTES} 1m bars per asset)\n` +
      `  ending:      ${new Date(endBucketSec * 1000).toISOString()}\n` +
      `\n` +
      `  open trades to refund:  ${openAll}  (${openReal} on real-money accounts)\n` +
      `  stake being returned:   ${((openStake._sum.stake ?? 0) / 100).toFixed(2)} INR\n` +
      `  trades to delete:       ${tradesToDelete}  (TRADES=${TRADES})\n` +
      `  demo accounts to reset: ${TRADES === "none" ? 0 : demoAccountIds.length}\n` +
      `  candles to delete:      ${candleCount}\n` +
      `  house aggregates:       ${RESET_HOUSE ? "RESET" : "left alone"}\n`,
  );

  if (!APPLY) {
    console.log("Dry run — nothing written. Re-run with APPLY=1 to execute.");
    return;
  }

  // 1. Refund every open position before the path under it disappears. One
  //    transaction each (voidTrade owns that), so a failure part-way leaves
  //    the trades it already refunded correctly settled rather than half-done.
  let refunded = 0;
  const openIds = await prisma.trade.findMany({
    where: { status: "OPEN" },
    select: { id: true },
  });
  for (const { id } of openIds) {
    try {
      await voidTrade(id);
      refunded += 1;
    } catch (err) {
      console.error(`  refund failed for trade ${id}:`, err);
      throw err;
    }
  }
  console.log(`Refunds:     ${refunded} open trades voided, stakes returned`);

  // 2. Delete the trade history that is being discarded. TradeShadow cascades.
  if (TRADES !== "none") {
    const deleted = await prisma.trade.deleteMany({ where: deleteWhere });
    console.log(
      `Trade wipe:  deleted ${deleted.count} rows (TradeShadow cascaded, TRADES=${TRADES})`,
    );

    // 3. The counters describe trades that no longer exist. Scope the reset to
    //    the accounts we actually emptied — a real account that kept its
    //    history keeps counters that are still true of it.
    const resetWhere = TRADES === "all" ? {} : { type: "DEMO" as const };
    const reset = await prisma.account.updateMany({
      where: resetWhere,
      data: { ...FRESH_COUNTERS, version: { increment: 1 } },
    });
    console.log(`Counters:    reset on ${reset.count} accounts`);
  }

  if (RESET_HOUSE) {
    const [days, ticks] = await Promise.all([
      prisma.houseDay.deleteMany({}),
      prisma.shadowTick.deleteMany({}),
    ]);
    await prisma.houseTreasury.updateMany({ data: { treasuryMinor: 0 } });
    console.log(
      `House reset: ${days.count} HouseDay rows, ${ticks.count} ShadowTick rows, treasury zeroed`,
    );
  }

  // 4. Charts.
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
