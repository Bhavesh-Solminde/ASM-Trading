import {
  CandleAggregator,
  INTRADAY_PROFILES,
  MARKET_NEWS,
  baseSigma,
  createRng,
  initMsm,
  initPriceState,
  intradayFactor,
  marketMsm,
  msmMultiplier,
  stepMsm,
  stepNews,
  stepPrice,
  withNews,
  TICK_DT_SEC,
  type Candle,
  type IntradayProfileName,
  type MsmState,
  type PriceParams,
  type PriceState,
  type Rng,
} from "@asm/pricing";
import { TIMEFRAMES, TIMEFRAME_SEC, type Timeframe } from "@asm/contracts";
import { prisma } from "@asm/db";
import { logger } from "@asm/logger";

export interface LiveAsset {
  id: string;
  symbol: string;
  /**
   * REAL assets anchor to an external live feed (Binance, Twelve Data). Any
   * price manipulation on these must stay tight enough to hide inside normal
   * per-tick volatility — a trader can compare against tradingview.
   *
   * OTC assets are fully synthetic; the platform is the sole reference, so
   * the resolver's undetectability cap can be wider.
   *
   * See MAX_HONEST_TICK_SHIFT_REAL / MAX_HONEST_TICK_SHIFT_OTC in
   * packages/algo/src/constants.ts.
   */
  kind: "REAL" | "OTC";
  payoutPct: number;
  precision: number;
  /** The asset's tick size — resolveBucket() snaps candidate exit prices to entryPrice ± this. */
  tickSize: number;
  params: PriceParams;
  state: PriceState;
  /**
   * The parallel, always-unbiased price path. Advances from the same `z`
   * draw as `state` on every tick, but with driftBias and magnet hard zero —
   * this is "what the market would have done" for the shadow ledger.
   */
  honestState: PriceState;
  /** MSM layer state, shared by shown and honest paths (volatility is exogenous). */
  vol: MsmState;
  /** Current news-shock level (0 = calm), shared by both paths. */
  news: number;
  /** Cached intraday profile reference so each tick can read it without a map lookup. */
  intraday: readonly number[];
  /** Latest real quote, or null until the feed delivers one. */
  anchor: number | null;
  /** One candle aggregator per offered timeframe, all fed the same tick stream. */
  aggregators: Map<Timeframe, CandleAggregator>;
}

export interface TickBias {
  /** Layer 2. Log-space bias, bounded to ±0.25·sigma by @asm/algo's driftBias(). */
  driftBias: number;
  /** Layer 3. Log-space pull toward an expiry target. Zero at tick granularity in Plan 04. */
  magnet: number;
  /**
   * Layer 5 (Phase 2A). Optional pull of the SHOWN path toward an internal
   * reference — the loop supplies the asset's own honest path on OTC assets
   * so their shown chart can't drift unboundedly during idle stretches. Only
   * applied to the shown path; the honest path never self-anchors (it's the
   * reference).
   */
  selfAnchorTarget?: number | null;
  selfAnchorAlpha?: number;
}

/** A candle that closed on this tick, tagged with the timeframe it belongs to. */
export interface ClosedCandle {
  timeframe: Timeframe;
  candle: Candle;
}

export interface TickResult {
  price: number;
  sigma: number;
}

// One simulated-time step per tick, from the shared cadence constant so the
// price model and the loop can never disagree about how long a tick is.
const DT_SEC = TICK_DT_SEC;

/**
 * Holds live per-asset price state in memory. This is why the engine is a
 * separate long-lived process rather than a Next.js route — MSM layers,
 * news-shock levels and in-progress candles cannot survive a serverless
 * request model.
 */
export class AssetRegistry {
  private assets = new Map<string, LiveAsset>();
  private rng: Rng;

  constructor(seed: number) {
    this.rng = createRng(seed);
  }

  async load(): Promise<void> {
    await this.ingest(await prisma.asset.findMany({ where: { isOpen: true } }));

    logger.info(
      { evt: "engine.assets_loaded", count: this.assets.size },
      "asset registry loaded",
    );
  }

  /**
   * Loads exactly the named assets, ignoring the `isOpen` filter that `load()`
   * applies. For tests and tooling that must exercise the price engine against
   * a specific market regardless of whether it is currently open — it reads
   * the existing rows and never changes their open state, so it neither
   * depends on nor mutates which markets users can trade.
   */
  async loadSymbols(symbols: string[]): Promise<void> {
    await this.ingest(await prisma.asset.findMany({ where: { symbol: { in: symbols } } }));
  }

  private async ingest(
    rows: Awaited<ReturnType<typeof prisma.asset.findMany>>,
  ): Promise<void> {
    for (const row of rows) {
      // Resume from the last published close, not the seed price. Positions
      // that rejoin after a restart settle on this path, so a reset to
      // basePrice would decide them by the restart rather than the market.
      const last = await prisma.candle.findFirst({
        where: { assetId: row.id, timeframe: "1m" },
        orderBy: { openTs: "desc" },
        select: { c: true, openTs: true },
      });

      const intradayProfile = INTRADAY_PROFILES[row.intradayProfile as IntradayProfileName];
      const params: PriceParams = {
        msm: marketMsm(row.msmSigma, row.msmM0),
        intraday: intradayProfile,
        news: MARKET_NEWS,
        driftPerSec: 0,
        anchorAlpha: row.anchorAlpha,
        // Headroom over the per-tick sigma so the clamp stays a 10+ sigma
        // backstop against a freak draw or a far-away commit snap, never
        // the dominant per-tick force. (tickSize × 200 kept the previous
        // GARCH-era behavior and continues to work with MSM.)
        maxTickMove: row.tickSize * 200,
        // 10s momentum half-life — at the live 5s cadence this lands 1m
        // bodies around 70% body / 30% wick, the ratio we want visually.
        trendPersistenceSec: 10,
      };

      const openedPrice = last?.c ?? row.basePrice;
      // Startup catchup backfill. If the latest persisted 1m candle is more
      // than one minute old (engine was down during a deploy, container was
      // being rotated, host was rebooted) we would otherwise leave a
      // visible multi-minute gap on every chart and resume at the stale
      // close. Fill the missing wall-clock minutes with the same
      // stepPrice algorithm the live loop uses, upsert them into the
      // Candle table, and resume from the catchup END price so the live
      // chart carries on seamlessly.
      const startPrice = await catchupMissingCandles({
        assetId: row.id,
        symbol: row.symbol,
        precision: row.precision,
        params,
        last,
        openedPrice,
      });

      this.assets.set(row.symbol, {
        id: row.id,
        symbol: row.symbol,
        kind: row.kind as "REAL" | "OTC",
        payoutPct: row.payoutPct,
        precision: row.precision,
        tickSize: row.tickSize,
        params,
        state: initPriceState(startPrice, params),
        honestState: initPriceState(startPrice, params),
        vol: initMsm(params.msm, this.rng.next),
        news: 0,
        intraday: intradayProfile,
        anchor: null,
        aggregators: new Map(
          TIMEFRAMES.map((tf) => [tf, new CandleAggregator(TIMEFRAME_SEC[tf])]),
        ),
      });
    }
  }

  symbols(): string[] {
    return [...this.assets.keys()];
  }

  get(symbol: string): LiveAsset | undefined {
    return this.assets.get(symbol);
  }

  all(): LiveAsset[] {
    return [...this.assets.values()];
  }

  setAnchor(symbol: string, price: number): void {
    const asset = this.assets.get(symbol);
    if (asset) asset.anchor = price;
  }

  /**
   * Volatility per √second right now, before this tick's MSM switches —
   * what the next tick will roughly use. The algo scales the magnet cap
   * from this.
   */
  sigmaNow(symbol: string, nowSec?: number): number {
    const asset = this.assets.get(symbol);
    if (!asset) throw new Error(`unknown symbol "${symbol}"`);
    return baseSigma(asset.state, asset.params) * this.volScale(asset, nowSec);
  }

  /**
   * The MSM × intraday × news multiplier right now, divorced from the
   * asset's base sigma. 1.0 at long-run average volatility, >1 in busy
   * stretches, <1 in quiet. The magnet uses this to hide its pull inside
   * natural noise.
   */
  volScaleNow(symbol: string, nowSec?: number): number {
    const asset = this.assets.get(symbol);
    if (!asset) throw new Error(`unknown symbol "${symbol}"`);
    return this.volScale(asset, nowSec);
  }

  private volScale(asset: LiveAsset, nowSec: number | undefined): number {
    let scale = msmMultiplier(asset.vol, asset.params.msm);
    if (nowSec !== undefined) scale *= intradayFactor(asset.intraday, nowSec);
    return withNews(scale, asset.news, MARKET_NEWS);
  }

  /**
   * Advances one asset by a single tick.
   *
   * `bias` steers the SHOWN path (driftBias from book imbalance, magnet from
   * expiry convergence — both supplied by the caller, since only the tick
   * loop and trade desk know the current book). The HONEST path advances
   * from the exact same `z` draw with driftBias and magnet hard zero, so it
   * always reflects what the market would have done unbiased. Diverging
   * the two paths only here, from one shared random draw, is what keeps
   * them a true counterfactual pair rather than two independent
   * simulations.
   */
  tick(symbol: string, nowSec: number, bias: TickBias): TickResult {
    const asset = this.assets.get(symbol);
    if (!asset) {
      throw new Error(`tick called for unknown symbol "${symbol}"`);
    }

    // Step MSM once per tick: the layers advance, and the new multiplier
    // flows into both paths through volScale. Each step consumes a few
    // uniforms from the shared RNG, so replay-by-seed stays intact.
    asset.vol = stepMsm(asset.vol, asset.params.msm, DT_SEC, this.rng.next);
    // News shocks arrive more often in busy hours.
    const intradayRate = intradayFactor(asset.intraday, nowSec);
    asset.news = stepNews(
      asset.news,
      MARKET_NEWS,
      DT_SEC,
      intradayRate,
      this.rng.next,
      this.rng.normal,
    );
    const volScale = withNews(
      msmMultiplier(asset.vol, asset.params.msm) * intradayRate,
      asset.news,
      MARKET_NEWS,
    );

    const z = this.rng.normal();

    const out = stepPrice({
      state: asset.state,
      params: asset.params,
      dtSec: DT_SEC,
      z,
      volScale,
      driftBias: bias.driftBias,
      magnet: bias.magnet,
      anchorTarget: asset.anchor,
      selfAnchorTarget: bias.selfAnchorTarget ?? null,
      selfAnchorAlpha: bias.selfAnchorAlpha ?? 0,
    });

    const honestOut = stepPrice({
      state: asset.honestState,
      params: asset.params,
      dtSec: DT_SEC,
      z,
      volScale,
      driftBias: 0,
      magnet: 0,
      anchorTarget: asset.anchor,
      // Honest path never self-anchors — it IS the reference.
      selfAnchorTarget: null,
      selfAnchorAlpha: 0,
    });

    asset.state = out.state;
    asset.honestState = honestOut.state;

    return { price: Number(out.price.toFixed(asset.precision)), sigma: out.sigma };
  }

  /**
   * Feeds the price actually SHOWN this tick into every timeframe's candle
   * and returns whichever candles closed. Kept separate from `tick` because
   * the loop may still move the price after stepping it (the commit-phase
   * snap); recording before that put highs/lows into candles that no viewer
   * ever saw as a live price, which drew phantom wicks when the bar closed.
   */
  record(symbol: string, nowSec: number, price: number): ClosedCandle[] {
    const asset = this.assets.get(symbol);
    if (!asset) {
      throw new Error(`record called for unknown symbol "${symbol}"`);
    }
    const rounded = Number(price.toFixed(asset.precision));
    const closed: ClosedCandle[] = [];
    for (const [timeframe, aggregator] of asset.aggregators) {
      const candle = aggregator.addTick(nowSec, rounded);
      if (candle) closed.push({ timeframe, candle });
    }
    return closed;
  }

  /** The in-progress candle for a symbol/timeframe, or null before its first tick. */
  formingCandle(symbol: string, timeframe: Timeframe): Candle | null {
    return this.assets.get(symbol)?.aggregators.get(timeframe)?.current() ?? null;
  }

  /** The unbiased price for `symbol` — the parallel path the shadow ledger compares against. */
  honestPrice(symbol: string): number {
    const asset = this.assets.get(symbol);
    if (!asset) {
      throw new Error(`honestPrice called for unknown symbol "${symbol}"`);
    }
    return Number(asset.honestState.price.toFixed(asset.precision));
  }
}

function hashSymbol(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

/**
 * On engine start, catches up any 1m candles that would otherwise be missing
 * between the last persisted close and the current wall-clock minute. Fills
 * each missing minute with 12 ticks of stepPrice using a per-asset seeded
 * Rng so the catchup is deterministic within one invocation and does not
 * consume draws from the shared live Rng. Returns the price the caller
 * should use to initialise the asset's live state — the catchup end price
 * if we filled anything, otherwise the plain `openedPrice`.
 *
 * MSM volatility is advanced inside the catchup too, so a long gap doesn't
 * all run at the flat long-run sigma. News shocks are deliberately omitted
 * here — a backfill shouldn't invent headlines.
 */
async function catchupMissingCandles(input: {
  assetId: string;
  symbol: string;
  precision: number;
  params: PriceParams;
  last: { c: number; openTs: Date } | null;
  openedPrice: number;
}): Promise<number> {
  const nowSec = Math.floor(Date.now() / 1000);
  // We only backfill COMPLETED minutes — the current forming bucket is for
  // the live loop to build out tick by tick. endBucketSec is the latest
  // completed 1m bucket's openTs.
  const endBucketSec = Math.floor(nowSec / 60) * 60 - 60;

  if (input.last === null) return input.openedPrice;
  const lastBucketSec = Math.floor(input.last.openTs.getTime() / 1000);
  let firstMissingSec = lastBucketSec + 60;

  if (endBucketSec < firstMissingSec) {
    return input.openedPrice;
  }

  // Optional cap for test environments where the gap can be days: an
  // uncapped backfill issues one Prisma transaction per 100 bars through
  // the shared pooler, so a 3-day gap × 19 assets runs for an hour. Set
  // CATCHUP_MAX_BARS to clamp the oldest end of the backfill window.
  const maxBars = Number.parseInt(process.env.CATCHUP_MAX_BARS ?? "0", 10);
  if (maxBars > 0) {
    const earliestAllowed = endBucketSec - (maxBars - 1) * 60;
    if (firstMissingSec < earliestAllowed) firstMissingSec = earliestAllowed;
  }

  // Deterministic per-asset Rng seeded on current time + symbol hash. The
  // shared live Rng is not touched, so replay semantics are preserved.
  const seed = (nowSec ^ hashSymbol(input.symbol)) & 0x7fffffff;
  const rng = createRng(seed);
  const ticksPerMinute = Math.round(60 / TICK_DT_SEC);
  let state = initPriceState(input.openedPrice, input.params);
  let vol = initMsm(input.params.msm, rng.next);

  const rows: { openTs: Date; o: number; h: number; l: number; c: number }[] = [];
  for (let bucketSec = firstMissingSec; bucketSec <= endBucketSec; bucketSec += 60) {
    const o = state.price;
    let h = o;
    let l = o;
    for (let t = 0; t < ticksPerMinute; t++) {
      vol = stepMsm(vol, input.params.msm, TICK_DT_SEC, rng.next);
      const intraday = input.params.intraday
        ? intradayFactor(input.params.intraday, bucketSec + t * TICK_DT_SEC)
        : 1;
      const volScale = msmMultiplier(vol, input.params.msm) * intraday;
      state = stepPrice({
        state,
        params: input.params,
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
      openTs: new Date(bucketSec * 1000),
      o: +o.toFixed(input.precision),
      h: +h.toFixed(input.precision),
      l: +l.toFixed(input.precision),
      c: +state.price.toFixed(input.precision),
    });
  }

  // Upsert so a parallel engine or a repeat ingest can't double-write the
  // same bucket. Chunked to keep the transaction small.
  const chunkSize = 100;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    await prisma.$transaction(
      chunk.map((r) =>
        prisma.candle.upsert({
          where: {
            assetId_timeframe_openTs: {
              assetId: input.assetId,
              timeframe: "1m",
              openTs: r.openTs,
            },
          },
          create: {
            assetId: input.assetId,
            timeframe: "1m",
            openTs: r.openTs,
            o: r.o,
            h: r.h,
            l: r.l,
            c: r.c,
          },
          update: {},
        }),
      ),
    );
  }

  logger.info(
    {
      evt: "engine.catchup_backfill",
      symbol: input.symbol,
      bars: rows.length,
      fromTs: rows[0]?.openTs.toISOString(),
      toTs: rows[rows.length - 1]?.openTs.toISOString(),
      startPrice: input.openedPrice,
      endPrice: +state.price.toFixed(input.precision),
    },
    "backfilled missing candles at engine start",
  );

  return state.price;
}
