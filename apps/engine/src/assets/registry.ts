import {
  CandleAggregator,
  createRng,
  initPriceState,
  stepPrice,
  type Candle,
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
}

/** A candle that closed on this tick, tagged with the timeframe it belongs to. */
export interface ClosedCandle {
  timeframe: Timeframe;
  candle: Candle;
}

export interface TickResult {
  price: number;
  sigma: number;
  /** Every timeframe whose candle closed on this tick (empty on most ticks). */
  closed: ClosedCandle[];
}

const TICK_HZ = 10;
const DT_SEC = 1 / TICK_HZ;

/**
 * Holds live per-asset price state in memory. This is why the engine is a
 * separate long-lived process rather than a Next.js route — GARCH state and a
 * forming candle cannot survive a serverless request model.
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
   * a specific market regardless of whether it is currently open — it reads the
   * existing rows and never changes their open state, so it neither depends on
   * nor mutates which markets users can trade.
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
        select: { c: true },
      });

      const params: PriceParams = {
        garch: { omega: row.garchOmega, alpha: row.garchAlpha, beta: row.garchBeta },
        driftPerSec: 0,
        anchorAlpha: row.anchorAlpha,
        // Two ticks of typical movement is generous but never implausible.
        maxTickMove: row.tickSize * 40,
      };

      const startPrice = last?.c ?? row.basePrice;

      this.assets.set(row.symbol, {
        id: row.id,
        symbol: row.symbol,
        payoutPct: row.payoutPct,
        precision: row.precision,
        tickSize: row.tickSize,
        params,
        state: initPriceState(startPrice, params),
        honestState: initPriceState(startPrice, params),
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
   * Advances one asset by a single tick.
   *
   * `bias` steers the SHOWN path (driftBias from book imbalance, magnet from
   * expiry convergence — both supplied by the caller, since only the tick
   * loop and trade desk know the current book). The HONEST path advances
   * from the exact same `z` draw with driftBias and magnet hard zero, so it
   * always reflects what the market would have done unbiased. Diverging the
   * two paths only here, from one shared random draw, is what keeps them a
   * true counterfactual pair rather than two independent simulations.
   */
  tick(symbol: string, nowSec: number, bias: TickBias): TickResult {
    const asset = this.assets.get(symbol);
    if (!asset) {
      throw new Error(`tick called for unknown symbol "${symbol}"`);
    }

    const z = this.rng.normal();

    const out = stepPrice({
      state: asset.state,
      params: asset.params,
      dtSec: DT_SEC,
      z,
      driftBias: bias.driftBias,
      magnet: bias.magnet,
      anchorTarget: asset.anchor,
    });

    const honestOut = stepPrice({
      state: asset.honestState,
      params: asset.params,
      dtSec: DT_SEC,
      z,
      driftBias: 0,
      magnet: 0,
      anchorTarget: asset.anchor,
    });

    asset.state = out.state;
    asset.honestState = honestOut.state;

    const rounded = Number(out.price.toFixed(asset.precision));

    // Feed every timeframe's aggregator the same tick; collect whichever closed.
    const closed: ClosedCandle[] = [];
    for (const [timeframe, aggregator] of asset.aggregators) {
      const candle = aggregator.addTick(nowSec, rounded);
      if (candle) closed.push({ timeframe, candle });
    }

    return { price: rounded, sigma: out.sigma, closed };
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
