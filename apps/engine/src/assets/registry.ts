import {
  CandleAggregator,
  createRng,
  initPriceState,
  perTickSigma,
  stepPrice,
  TICK_DT_SEC,
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
  tickSize: number;
  params: PriceParams;
  state: PriceState;
  /** Parallel honest path — same z, zero bias. Drives shadow ledger OHLC. */
  honestState: PriceState;
  /** Latest real quote, or null until the feed delivers one. */
  anchor: number | null;
  aggregator: CandleAggregator;
  honestAggregator: CandleAggregator;
}

/** Bias supplied by the controller for one tick. */
export interface TickBias {
  /** Layer 2: drift bias in log-price space. */
  driftBias: number;
  /** Layer 3: expiry magnet in log-price space. */
  magnet: number;
}

const UNBIASED: TickBias = { driftBias: 0, magnet: 0 };

export interface TickResult {
  price: number;
  honestPrice: number;
  sigmaTick: number;
  /** Non-null exactly when this tick closed a shown candle. */
  closed: Candle | null;
  /** Non-null when the honest path closes a candle (may differ from closed). */
  honestClosed: Candle | null;
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

      this.assets.set(row.symbol, {
        id: row.id,
        symbol: row.symbol,
        payoutPct: row.payoutPct,
        precision: row.precision,
        tickSize: row.tickSize,
        params,
        state: initPriceState(last?.c ?? row.basePrice, params),
        honestState: initPriceState(last?.c ?? row.basePrice, params),
        anchor: null,
        aggregator: new CandleAggregator(60),
        honestAggregator: new CandleAggregator(60),
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
   * A single z is drawn and used for BOTH the shown and honest paths so the
   * two paths share the same underlying random walk. The only difference is
   * the bias terms, which are zero for the honest path.
   *
   * Zero bias → shown price equals honest price (verifiable by tests).
   */
  tick(symbol: string, nowSec: number, bias: TickBias = UNBIASED): TickResult {
    const asset = this.assets.get(symbol);
    if (!asset) {
      throw new Error(`tick called for unknown symbol "${symbol}"`);
    }

    const z = this.rng.normal();

    // Shown path — bias applied.
    const shown = stepPrice({
      state: asset.state,
      params: asset.params,
      dtSec: TICK_DT_SEC,
      z,
      driftBias: bias.driftBias,
      magnet: bias.magnet,
      anchorTarget: asset.anchor,
    });
    asset.state = shown.state;

    // Honest path — zero bias, same z.
    const honest = stepPrice({
      state: asset.honestState,
      params: asset.params,
      dtSec: TICK_DT_SEC,
      z,
      driftBias: 0,
      magnet: 0,
      anchorTarget: asset.anchor,
    });
    asset.honestState = honest.state;

    const rounded = Number(shown.price.toFixed(asset.precision));
    const honestRounded = Number(honest.price.toFixed(asset.precision));

    const closed = asset.aggregator.addTick(nowSec, rounded);
    const honestClosed = asset.honestAggregator.addTick(nowSec, honestRounded);

    return {
      price: rounded,
      honestPrice: honestRounded,
      sigmaTick: perTickSigma(shown.sigma, TICK_DT_SEC),
      closed,
      honestClosed,
    };
  }
}
