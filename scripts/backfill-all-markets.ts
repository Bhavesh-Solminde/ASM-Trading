/**
 * Pre-populates every open asset with HOURS hours of synthetic 1m
 * candles using whatever GARCH preset is currently stored on each asset
 * row (flat, in the current tree). Upserts replace any existing rows in
 * that window. The engine continues from the latest close when it next
 * runs.
 *
 *   DATABASE_URL=... DIRECT_URL=... pnpm tsx scripts/backfill-all-markets.ts
 *   DATABASE_URL=... DIRECT_URL=... pnpm tsx scripts/backfill-all-markets.ts NIFTY50
 *   HOURS=24 DATABASE_URL=... DIRECT_URL=... pnpm tsx scripts/backfill-all-markets.ts
 *
 * The CLI arg filters to a single symbol; omitted → every isOpen asset.
 */
import { prisma } from "../packages/db/src/client";
import {
  createRng,
  initPriceState,
  stepPrice,
  TICK_DT_SEC,
  type PriceParams,
} from "../packages/pricing/src/index";

const HOURS = Number(process.env["HOURS"] ?? 10);
const MINUTES = HOURS * 60;

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

async function backfill(asset: AssetRow, endBucketSec: number, wipeFirst: boolean) {
  const params: PriceParams = {
    garch: { omega: asset.garchOmega, alpha: asset.garchAlpha, beta: asset.garchBeta },
    driftPerSec: 0,
    anchorAlpha: 0,
    maxTickMove: asset.tickSize * 200,
  };

  // WIPE_FIRST=1 clears every stored candle for the asset so the backfill
  // is the sole source of truth. The engine MUST be stopped during this —
  // otherwise its live writes would race the wipe + reinsert and leave the
  // chart with the gap this flag exists to prevent.
  let deletedCount = 0;
  if (wipeFirst) {
    const r = await prisma.candle.deleteMany({ where: { assetId: asset.id } });
    deletedCount = r.count;
  }

  const latest = wipeFirst
    ? null
    : await prisma.candle.findFirst({
        where: { assetId: asset.id, timeframe: "1m" },
        orderBy: { openTs: "desc" },
        select: { c: true },
      });
  const startPrice = latest?.c ?? asset.basePrice;

  const ticksPerMinute = Math.round(60 / TICK_DT_SEC);
  const rng = createRng((Date.now() ^ hashSymbol(asset.symbol)) & 0x7fffffff);
  let state = initPriceState(startPrice, params);
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

  const chunkSize = 50;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    await prisma.$transaction(
      chunk.map((r) =>
        prisma.candle.upsert({
          where: {
            assetId_timeframe_openTs: {
              assetId: asset.id,
              timeframe: "1m",
              openTs: r.openTs,
            },
          },
          create: {
            assetId: asset.id,
            timeframe: "1m",
            openTs: r.openTs,
            o: r.o,
            h: r.h,
            l: r.l,
            c: r.c,
          },
          update: { o: r.o, h: r.h, l: r.l, c: r.c },
        }),
      ),
    );
  }

  const wipedTag = wipeFirst ? ` (wiped ${deletedCount})` : "";
  console.log(
    `${asset.symbol.padEnd(16)} ${rows.length} bars${wipedTag}  start ${startPrice} → end ${rows.at(-1)?.c}`,
  );
}

async function main() {
  const symbolFilter = process.argv[2];
  const assets: AssetRow[] = await prisma.asset.findMany({
    where: symbolFilter
      ? { symbol: symbolFilter }
      : { isOpen: true },
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
    console.error(`No matching assets found${symbolFilter ? ` for "${symbolFilter}"` : ""}.`);
    process.exit(1);
  }

  const wipeFirst = process.env["WIPE_FIRST"] === "1";
  const nowSec = Math.floor(Date.now() / 1000);
  const endBucketSec = Math.floor(nowSec / 60) * 60 - 60;

  console.log(
    `Backfilling ${HOURS}h (${MINUTES} bars) for ${assets.length} asset(s), ending ${new Date(endBucketSec * 1000).toISOString()}${
      wipeFirst ? " (wiping existing candles first — ENGINE MUST BE STOPPED)" : ""
    }\n`,
  );

  for (const asset of assets) {
    await backfill(asset, endBucketSec, wipeFirst);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
