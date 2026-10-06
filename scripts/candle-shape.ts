/**
 * Candle-shape check: how much of each candle is body vs wick.
 *
 * Reads the stored 1m candles for one asset and compares their shape against
 * an honest baseline: the same asset's GARCH params run through the real
 * `stepPrice` (packages/pricing) with no bias, magnet or snap. A pure random
 * walk sampled every TICK_DT_SEC puts the body at roughly half the candle's
 * high-low range; stored candles well below that baseline mean something on
 * top of the walk (steering, snaps, recording bugs) is stretching the wicks.
 *
 *   Run:  pnpm tsx scripts/candle-shape.ts [SYMBOL] [HOURS]
 *         (defaults: NIFTY50, 6). Reads DATABASE_URL like the engine does.
 *
 * Read-only: it selects candle prices and asset params, nothing else.
 */

import { prisma } from "../packages/db/src/client";
import { createRng, initPriceState, stepPrice, TICK_DT_SEC, type PriceParams } from "../packages/pricing/src/index";

interface Shape {
  count: number;
  /** Mean high-low range. */
  range: number;
  /** Mean |close - open|. */
  body: number;
  /** Mean of body / range per candle (0..1). */
  bodyShare: number;
  /** Share of candles whose body is under 20% of their range. */
  dojiShare: number;
}

function shapeOf(candles: { o: number; h: number; l: number; c: number }[]): Shape {
  const ranged = candles.filter((k) => k.h > k.l);
  const mean = (xs: number[]) => (xs.length === 0 ? 0 : xs.reduce((s, x) => s + x, 0) / xs.length);
  const shares = ranged.map((k) => Math.abs(k.c - k.o) / (k.h - k.l));
  return {
    count: candles.length,
    range: mean(candles.map((k) => k.h - k.l)),
    body: mean(candles.map((k) => Math.abs(k.c - k.o))),
    bodyShare: mean(shares),
    dojiShare: shares.length === 0 ? 0 : shares.filter((s) => s < 0.2).length / shares.length,
  };
}

/** Honest random-walk baseline: the asset's own params, 1m candles, no steering. */
function baseline(params: PriceParams, startPrice: number, minutes: number): Shape {
  const rng = createRng(20261006);
  let state = initPriceState(startPrice, params);
  const ticksPerMinute = Math.round(60 / TICK_DT_SEC);
  const candles: { o: number; h: number; l: number; c: number }[] = [];
  for (let m = 0; m < minutes; m++) {
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
      h = Math.max(h, state.price);
      l = Math.min(l, state.price);
    }
    candles.push({ o, h, l, c: state.price });
  }
  return shapeOf(candles);
}

function print(label: string, s: Shape): void {
  console.log(
    `${label.padEnd(22)} n=${String(s.count).padStart(5)}  range=${s.range.toFixed(2).padStart(8)}  body=${s.body
      .toFixed(2)
      .padStart(8)}  body/range=${(s.bodyShare * 100).toFixed(1).padStart(5)}%  doji(<20%)=${(s.dojiShare * 100)
      .toFixed(1)
      .padStart(5)}%`,
  );
}

const symbol = process.argv[2] ?? "NIFTY50";
const hours = Number(process.argv[3] ?? 6);

const asset = await prisma.asset.findUniqueOrThrow({
  where: { symbol },
  select: { id: true, basePrice: true, tickSize: true, garchOmega: true, garchAlpha: true, garchBeta: true },
});
const stored = await prisma.candle.findMany({
  where: { assetId: asset.id, timeframe: "1m", openTs: { gt: new Date(Date.now() - hours * 3600_000) } },
  select: { o: true, h: true, l: true, c: true },
  orderBy: { openTs: "asc" },
});

const params: PriceParams = {
  garch: { omega: asset.garchOmega, alpha: asset.garchAlpha, beta: asset.garchBeta },
  driftPerSec: 0,
  anchorAlpha: 0,
  maxTickMove: asset.tickSize * 40, // same cap the engine registry applies
};

console.log(`${symbol} · last ${hours}h of 1m candles vs an unsteered random walk (TICK_DT_SEC=${TICK_DT_SEC})\n`);
print("stored candles", shapeOf(stored));
print("random-walk baseline", baseline(params, stored.at(-1)?.c ?? asset.basePrice, 20_000));

await prisma.$disconnect();
