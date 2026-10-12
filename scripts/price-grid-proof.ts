/**
 * Before/after proof for the display-grid + quiet-floor change.
 *
 * Runs the REAL price model (packages/pricing `stepPrice` / `stepMsm` /
 * `intradayFactor`) twice over the same random draws, once with the settings
 * this branch replaces and once with the new ones, then renders both as 1m
 * candles and reports the shape statistics side by side.
 *
 * Driving both arms from one seeded RNG is the point: the two charts differ
 * only by the two things being changed, never by luck.
 *
 *   Run:  pnpm tsx scripts/price-grid-proof.ts [out.html]
 *         (default: price-grid-proof.html in the repo root)
 *
 * Pure simulation — reads nothing, writes one HTML file.
 */

import { writeFileSync } from "node:fs";
import {
  CRYPTO_INTRADAY,
  FX_MAJOR_INTRADAY,
  MARKET_NEWS,
  MSM_QUIET_FLOOR,
  createRng,
  initPriceState,
  intradayFactor,
  marketMsm,
  msmMultiplier,
  stepMsm,
  stepPrice,
  TICK_DT_SEC,
  type MsmParams,
  type MsmState,
  type PriceParams,
} from "../packages/pricing/src/index";

const MINUTES = 90;
const TICKS_PER_MIN = Math.round(60 / TICK_DT_SEC);
const SEED = 20261012;

interface Case {
  symbol: string;
  price: number;
  sigma: number;
  m0: number;
  tickSize: number;
  intraday: readonly number[];
  oldPrecision: number;
  newPrecision: number;
}

const CASES: Case[] = [
  {
    symbol: "XRP/USDT",
    price: 1.367,
    sigma: 1.03e-4,
    m0: 1.55,
    tickSize: 0.0001,
    intraday: CRYPTO_INTRADAY,
    oldPrecision: 4,
    newPrecision: 5,
  },
  {
    symbol: "EUR/USD",
    price: 1.08,
    sigma: 1.04e-5,
    m0: 1.5,
    tickSize: 0.00001,
    intraday: FX_MAJOR_INTRADAY,
    oldPrecision: 5,
    newPrecision: 6,
  },
  {
    symbol: "SOL/USDT",
    price: 180,
    sigma: 9.33e-5,
    m0: 1.55,
    tickSize: 0.01,
    intraday: CRYPTO_INTRADAY,
    oldPrecision: 2,
    newPrecision: 3,
  },
];

interface Candle {
  o: number;
  h: number;
  l: number;
  c: number;
}

/** The multiplier as it behaved BEFORE this branch: raw, unfloored. */
function rawMultiplier(state: MsmState): number {
  return Math.sqrt(state.layers.reduce((a, b) => a * b, 1));
}

/**
 * Start the volatility state in a named regime instead of drawing one.
 *
 * A single 90-minute window samples exactly ONE regime — the slow MSM layers
 * barely move in an hour and a half — so a randomly seeded run proves nothing
 * about the case being fixed. The reported chart was a quiet regime; that is
 * the one the charts below have to show.
 */
/**
 * The layers that still hold their value 90 minutes later.
 *
 * Layers are ordered slowest-first and spaced geometrically from ~1 second to
 * ~3 days, so over a 90-minute window only the first three (3 days, 12 hours,
 * 2 hours) persist. Everything faster re-draws several times and averages
 * out. A "regime", for the length of a chart someone is looking at, is
 * therefore just the state of those three.
 */
const PERSISTENT_LAYERS = 3;

/**
 * Pin the persistent layers and draw the rest.
 *
 * `slowHigh` is how many of the three are in their high state: 0 is the dead
 * regime this branch is about, 3 is a burst. The fast layers come from the
 * same seeded RNG as the rest of the run, so the two arms still see identical
 * draws.
 */
function regimeState(msm: MsmParams, slowHigh: number, uniform: () => number): MsmState {
  return {
    layers: Array.from({ length: msm.components }, (_, k) => {
      if (k < PERSISTENT_LAYERS) return k < slowHigh ? msm.m0 : 2 - msm.m0;
      return uniform() < 0.5 ? msm.m0 : 2 - msm.m0;
    }),
  };
}

function simulate(
  testCase: Case,
  opts: { precision: number; floored: boolean; slowHigh: number; seed?: number },
): Candle[] {
  const msm: MsmParams = marketMsm(testCase.sigma, testCase.m0);
  const params: PriceParams = {
    msm,
    intraday: testCase.intraday,
    news: MARKET_NEWS,
    driftPerSec: 0,
    anchorAlpha: 0,
    maxTickMove: testCase.tickSize * 200,
    trendPersistenceSec: 10,
  };

  // Both arms draw from an identically seeded RNG and consume uniforms in the
  // same order, so tick n sees the same z and the same layer flips in each.
  const rng = createRng(opts.seed ?? SEED);
  let vol = regimeState(msm, opts.slowHigh, rng.next);
  let state = initPriceState(testCase.price, params);
  // 02:00 UTC — the quiet hour the reported screenshot was taken in.
  const baseSec = Math.floor(Date.UTC(2026, 9, 12, 2, 0, 0) / 1000);

  const candles: Candle[] = [];
  for (let m = 0; m < MINUTES; m++) {
    const prices: number[] = [];
    for (let t = 0; t < TICKS_PER_MIN; t++) {
      const nowSec = baseSec + m * 60 + t * TICK_DT_SEC;
      vol = stepMsm(vol, msm, TICK_DT_SEC, rng.next);
      const multiplier = opts.floored ? msmMultiplier(vol, msm) : rawMultiplier(vol);
      state = stepPrice({
        state,
        params,
        dtSec: TICK_DT_SEC,
        z: rng.normal(),
        volScale: multiplier * intradayFactor(testCase.intraday, nowSec),
        driftBias: 0,
        magnet: 0,
        anchorTarget: null,
      }).state;
      // Exactly what the engine publishes — registry.record() rounds here.
      prices.push(Number(state.price.toFixed(opts.precision)));
    }
    candles.push({
      o: prices[0]!,
      h: Math.max(...prices),
      l: Math.min(...prices),
      c: prices[prices.length - 1]!,
    });
  }
  return candles;
}

interface Stats {
  avgSteps: number;
  wicklessPct: number;
  dojiPct: number;
  levels: number;
}

function stats(candles: Candle[], precision: number): Stats {
  const grid = 10 ** -precision;
  const steps = candles.map((k) => (k.h - k.l) / grid);
  const wickless = candles.filter(
    (k) => k.h === Math.max(k.o, k.c) && k.l === Math.min(k.o, k.c),
  ).length;
  const doji = candles.filter((k) => k.o === k.c).length;
  const levels = new Set(candles.flatMap((k) => [k.o, k.h, k.l, k.c])).size;
  return {
    avgSteps: steps.reduce((a, b) => a + b, 0) / steps.length,
    wicklessPct: (wickless / candles.length) * 100,
    dojiPct: (doji / candles.length) * 100,
    levels,
  };
}

const W = 560;
const H = 260;
const PAD = 8;

/**
 * The last `VISIBLE` candles, which is roughly what fits on a phone — and the
 * framing the reported screenshot was in. Over the full 90 minutes the price
 * wanders far enough that auto-scaling hides the quantisation; zoomed in to
 * what a user actually sees, it is the whole story.
 */
const VISIBLE = 28;

function renderChart(all: Candle[], precision: number): string {
  const candles = all.slice(-VISIBLE);
  const grid = 10 ** -precision;
  const hi = Math.max(...candles.map((k) => k.h));
  const lo = Math.min(...candles.map((k) => k.l));
  const span = hi - lo || grid;
  const y = (p: number) => PAD + (1 - (p - lo) / span) * (H - 2 * PAD);
  const slot = (W - 2 * PAD) / candles.length;
  const bw = Math.max(1.5, slot * 0.62);

  // One faint line per price the chart is able to show. When these are
  // countable, the price is on a lattice and every candle has to start and
  // end on one of them — that is the artefact. Past ~60 the grid is finer
  // than the eye, which is the point of the fix, so stop drawing it.
  const steps = Math.round(span / grid);
  const gridLines =
    steps <= 60
      ? Array.from({ length: steps + 1 }, (_, i) => {
          const gy = y(lo + i * grid);
          return `<line x1="${PAD}" x2="${W - PAD}" y1="${gy.toFixed(1)}" y2="${gy.toFixed(1)}" stroke="#2b3440" stroke-width="0.5"/>`;
        }).join("")
      : "";

  const bars = candles
    .map((k, i) => {
      const cx = PAD + slot * (i + 0.5);
      const up = k.c >= k.o;
      const colour = up ? "#22c55e" : "#ef4444";
      const top = y(Math.max(k.o, k.c));
      const bot = y(Math.min(k.o, k.c));
      // A zero-height body still has to be visible, exactly as the real chart
      // library draws it — this is why a lattice reads as solid rectangles.
      const h = Math.max(1, bot - top);
      return (
        `<line x1="${cx.toFixed(1)}" x2="${cx.toFixed(1)}" y1="${y(k.h).toFixed(1)}" ` +
        `y2="${y(k.l).toFixed(1)}" stroke="${colour}" stroke-width="1"/>` +
        `<rect x="${(cx - bw / 2).toFixed(1)}" y="${top.toFixed(1)}" ` +
        `width="${bw.toFixed(1)}" height="${h.toFixed(1)}" fill="${colour}"/>`
      );
    })
    .join("");

  const label =
    steps <= 60
      ? `${steps} price level${steps === 1 ? "" : "s"} available`
      : `${steps} price levels available`;
  return `<svg viewBox="0 0 ${W} ${H + 18}" width="100%" preserveAspectRatio="xMidYMid meet">
    <rect width="${W}" height="${H}" fill="#0b0e11"/>${gridLines}${bars}
    <text x="${PAD}" y="${H + 13}" fill="#6b7580" font-size="11"
      font-family="ui-sans-serif,system-ui,sans-serif">${label}</text></svg>`;
}

function pct(n: number): string {
  return `${n.toFixed(0)}%`;
}

/** Mean of a statistic over many seeds, so one lucky window can't decide it. */
function aggregate(
  testCase: Case,
  opts: { precision: number; floored: boolean; slowHigh: number },
  seeds = 120,
): Stats {
  const acc: Stats = { avgSteps: 0, wicklessPct: 0, dojiPct: 0, levels: 0 };
  for (let s = 0; s < seeds; s++) {
    const one = stats(simulate(testCase, { ...opts, seed: SEED + s * 7919 }), opts.precision);
    acc.avgSteps += one.avgSteps;
    acc.wicklessPct += one.wicklessPct;
    acc.dojiPct += one.dojiPct;
    acc.levels += one.levels;
  }
  return {
    avgSteps: acc.avgSteps / seeds,
    wicklessPct: acc.wicklessPct / seeds,
    dojiPct: acc.dojiPct / seeds,
    levels: acc.levels / seeds,
  };
}

// None of the three persistent layers high is the dead regime the reported
// screenshot was in — it holds for hours because the slowest layer re-draws
// about every three days. Two of three is an ordinary window.
const QUIET_LAYERS = 0;
const MEDIAN_LAYERS = 2;

const sections = CASES.map((testCase) => {
  const beforeOpts = { precision: testCase.oldPrecision, floored: false };
  const afterOpts = { precision: testCase.newPrecision, floored: true };

  const before = simulate(testCase, { ...beforeOpts, slowHigh: QUIET_LAYERS });
  const after = simulate(testCase, { ...afterOpts, slowHigh: QUIET_LAYERS });

  const quietB = aggregate(testCase, { ...beforeOpts, slowHigh: QUIET_LAYERS });
  const quietA = aggregate(testCase, { ...afterOpts, slowHigh: QUIET_LAYERS });
  const medB = aggregate(testCase, { ...beforeOpts, slowHigh: MEDIAN_LAYERS });
  const medA = aggregate(testCase, { ...afterOpts, slowHigh: MEDIAN_LAYERS });

  const row = (label: string, b: string, a: string, better: boolean) =>
    `<tr><th>${label}</th><td>${b}</td><td class="${better ? "good" : ""}">${a}</td></tr>`;

  return `<section>
    <h2>${testCase.symbol}</h2>
    <div class="grid">
      <figure>
        <figcaption>Before — ${testCase.oldPrecision} decimals, no quiet floor. Last ${VISIBLE} minutes; each faint line is a price the chart can show.</figcaption>
        ${renderChart(before, testCase.oldPrecision)}
      </figure>
      <figure>
        <figcaption>After — ${testCase.newPrecision} decimals, floor ${MSM_QUIET_FLOOR}. Same ${VISIBLE} minutes, same random draws.</figcaption>
        ${renderChart(after, testCase.newPrecision)}
      </figure>
    </div>
    <table>
      <tr><th>Quiet regime — averaged over 120 runs</th><th>before</th><th>after</th></tr>
      ${row("Average candle height, in display steps", quietB.avgSteps.toFixed(1), quietA.avgSteps.toFixed(1), quietA.avgSteps > quietB.avgSteps)}
      ${row("Candles with no wick at all", pct(quietB.wicklessPct), pct(quietA.wicklessPct), quietA.wicklessPct < quietB.wicklessPct)}
      ${row("Candles that open and close at the same price", pct(quietB.dojiPct), pct(quietA.dojiPct), quietA.dojiPct < quietB.dojiPct)}
      ${row("Distinct prices per 90 minutes", quietB.levels.toFixed(0), quietA.levels.toFixed(0), quietA.levels > quietB.levels)}
    </table>
    <table>
      <tr><th>Median regime — averaged over 120 runs</th><th>before</th><th>after</th></tr>
      ${row("Average candle height, in display steps", medB.avgSteps.toFixed(1), medA.avgSteps.toFixed(1), medA.avgSteps > medB.avgSteps)}
      ${row("Candles with no wick at all", pct(medB.wicklessPct), pct(medA.wicklessPct), medA.wicklessPct < medB.wicklessPct)}
      ${row("Distinct prices per 90 minutes", medB.levels.toFixed(0), medA.levels.toFixed(0), medA.levels > medB.levels)}
    </table>
  </section>`;
}).join("");

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Price grid proof</title>
<style>
  :root { color-scheme: dark; }
  body { background:#0b0e11; color:#e6e8eb; font:14px/1.5 ui-sans-serif,system-ui,sans-serif;
         margin:0; padding:24px; }
  h1 { font-size:20px; margin:0 0 4px; }
  p.lede { color:#9aa4b2; margin:0 0 28px; max-width:70ch; }
  section { margin-bottom:40px; }
  h2 { font-size:16px; margin:0 0 10px; }
  .grid { display:grid; grid-template-columns:1fr 1fr; gap:14px; }
  @media (max-width:760px) { .grid { grid-template-columns:1fr; } }
  figure { margin:0; }
  figcaption { color:#9aa4b2; font-size:12px; margin-bottom:6px; }
  table { border-collapse:collapse; margin-top:12px; font-size:13px; width:100%; }
  th, td { text-align:left; padding:5px 10px; border-bottom:1px solid #1b2027; }
  th { color:#9aa4b2; font-weight:500; }
  td { font-variant-numeric:tabular-nums; }
  td.good { color:#22c55e; }
</style></head>
<body>
<h1>Display grid + quiet floor — before and after</h1>
<p class="lede">${MINUTES} one-minute candles from the real price model at 02:00 UTC,
started in the quiet volatility regime the reported chart was in. Both columns run
on one seeded RNG and consume the same draws in the same order, so the only
differences are the decimal places the price is rounded to and the floor under the
MSM volatility multiplier. The tables average 120 independent runs each, because a
single window samples only one regime.</p>
${sections}
</body></html>`;

const out = process.argv[2] ?? "price-grid-proof.html";
writeFileSync(out, html);
console.log(`Wrote ${out}`);

// Console summary, and the gate: the whole point is that no market is left
// drawing candles shorter than MIN_DISPLAY_STEPS_PER_UPDATE can support.
let failed = false;
for (const regime of [
  { name: "quiet ", slowHigh: QUIET_LAYERS },
  { name: "median", slowHigh: MEDIAN_LAYERS },
]) {
  for (const testCase of CASES) {
    const sb = aggregate(testCase, {
      precision: testCase.oldPrecision,
      floored: false,
      slowHigh: regime.slowHigh,
    });
    const sa = aggregate(testCase, {
      precision: testCase.newPrecision,
      floored: true,
      slowHigh: regime.slowHigh,
    });
    const ok = sa.avgSteps >= 3 && sa.wicklessPct < sb.wicklessPct;
    if (!ok) failed = true;
    console.log(
      `${regime.name} ${testCase.symbol.padEnd(9)} height ${sb.avgSteps.toFixed(1)} -> ${sa.avgSteps.toFixed(1)} steps` +
        ` | wickless ${pct(sb.wicklessPct)} -> ${pct(sa.wicklessPct)}` +
        ` | levels ${sb.levels.toFixed(0)} -> ${sa.levels.toFixed(0)}  ${ok ? "PASS" : "FAIL"}`,
    );
  }
}
if (failed) {
  console.error("\nFAILED: a market still draws candles too short to read.");
  process.exit(1);
}
console.log("\nAll markets pass.");
