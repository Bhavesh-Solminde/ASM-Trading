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
import { prisma } from "@asm/db";
import { logger } from "@asm/logger";

export interface LiveAsset {
  id: string;
  symbol: string;
  payoutPct: number;
  precision: number;
  params: PriceParams;
  state: PriceState;
  /** Latest real quote, or null until the feed delivers one. */
  anchor: number | null;
  aggregator: CandleAggregator;
}

export interface TickResult {
  price: number;
  sigma: number;
  /** Non-null exactly when this tick closed a candle. */
  closed: Candle | null;
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
    const rows = await prisma.asset.findMany({ where: { isOpen: true } });

    for (const row of rows) {
      const params: PriceParams = {
        garch: { omega: row.garchOmega, alpha: row.garchAlpha, beta: row.garchBeta },
        driftPerSec: 0,
        anchorAlpha: row.anchorAlpha,
        // Two ticks of typical movement is generous but never implausible.
        maxTickMove: row.tickSize * 40,
      };

      this.assets.set(row.symbol, {
        id: row.id,
        symbol: row.symbol,
        payoutPct: row.payoutPct,
        precision: row.precision,
        params,
        state: initPriceState(row.basePrice, params),
        anchor: null,
        aggregator: new CandleAggregator(60),
      });
    }

    logger.info(
      { evt: "engine.assets_loaded", count: this.assets.size },
      "asset registry loaded",
    );
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
   * driftBias and magnet are hard zero in this plan — the engine is
   * deliberately unbiased until Plan 04 supplies a controller. Leaving the
   * parameters in place means Plan 04 is a wiring change, not a rewrite.
   */
  tick(symbol: string, nowSec: number): TickResult {
    const asset = this.assets.get(symbol);
    if (!asset) {
      throw new Error(`tick called for unknown symbol "${symbol}"`);
    }

    const out = stepPrice({
      state: asset.state,
      params: asset.params,
      dtSec: DT_SEC,
      z: this.rng.normal(),
      driftBias: 0,
      magnet: 0,
      anchorTarget: asset.anchor,
    });

    asset.state = out.state;

    const rounded = Number(out.price.toFixed(asset.precision));
    const closed = asset.aggregator.addTick(nowSec, rounded);

    return { price: rounded, sigma: out.sigma, closed };
  }
}
