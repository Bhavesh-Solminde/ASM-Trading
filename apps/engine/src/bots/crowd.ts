import { openTradeRecord, resetDemoBalance } from "@asm/db";
import { expirySecFor } from "@asm/trading";
import { createRng } from "@asm/pricing";
import { logger } from "@asm/logger";
import { DeskRejection } from "../trading/errors";
import { pickProfile, chooseDirection, chooseStake } from "./profiles";
import type { AssetRegistry } from "../assets/registry";

const BOT_DEMO_BALANCE = 10_000_000;
const MIN_BALANCE_REFILL = 500_000;

interface BotSlot {
  accountId: string;
  assetId: string;
  symbol: string;
  profile: ReturnType<typeof pickProfile>;
  lastLost: boolean;
  timer: NodeJS.Timeout | null;
}

/**
 * Manages a crowd of bots that open positions to keep the book warm.
 *
 * Each bot independently draws an exponentially distributed inter-arrival
 * time (Poisson process) so arrivals are not bursty. Bots open trades via
 * the raw DB function (openTradeRecord) rather than through TradeDesk.open()
 * — they bypass the WishSource entirely so the controller targets only human
 * win rates. The book still sees their positions for imbalance / drift bias.
 *
 * Balance is topped up with resetDemoBalance when it falls below the refill
 * threshold so bots never run out of funds.
 */
export class BotCrowd {
  private slots: BotSlot[] = [];
  private running = false;
  private readonly rng = createRng(0xdeadbeef);

  constructor(
    private readonly bots: { userId: string; accountId: string }[],
    private readonly assets: AssetRegistry,
  ) {}

  start(): void {
    this.running = true;
    const assetList = this.assets.all();
    if (assetList.length === 0) return;

    for (const bot of this.bots) {
      const asset = assetList[Math.floor(this.rng.next() * assetList.length)]!;
      const slot: BotSlot = {
        accountId: bot.accountId,
        assetId: asset.id,
        symbol: asset.symbol,
        profile: pickProfile(this.rng),
        lastLost: false,
        timer: null,
      };
      this.slots.push(slot);
      this.scheduleNext(slot);
    }

    logger.info({ evt: "bots.started", count: this.bots.length }, "bot crowd started");
  }

  async stop(): Promise<void> {
    this.running = false;
    for (const slot of this.slots) {
      if (slot.timer) clearTimeout(slot.timer);
    }
  }

  private scheduleNext(slot: BotSlot): void {
    if (!this.running) return;
    // Exponential inter-arrival: -mean * ln(U) where U ~ Uniform(0,1)
    const meanMs = slot.profile.arrivalRateSec * 1000;
    const waitMs = -meanMs * Math.log(Math.max(this.rng.next(), 1e-9));
    slot.timer = setTimeout(() => void this.arrive(slot), waitMs);
  }

  private async arrive(slot: BotSlot): Promise<void> {
    if (!this.running) return;

    const asset = this.assets.get(slot.symbol);
    if (!asset) {
      this.scheduleNext(slot);
      return;
    }

    const entryPrice = Number(asset.state.price.toFixed(asset.precision));
    const recentMove = asset.state.price - asset.honestState.price;
    const direction = chooseDirection(slot.profile, recentMove, this.rng);
    const stake = chooseStake(slot.profile, slot.lastLost, this.rng);

    const entryTs = new Date();
    const expiryTs = new Date(entryTs.getTime() + slot.profile.durationSec * 1000);

    try {
      await openTradeRecord({
        accountId: slot.accountId,
        assetId: slot.assetId,
        direction,
        stake,
        payoutPct: slot.profile.payoutPct,
        entryPrice,
        entryTs,
        expiryTs,
      });

      logger.debug(
        { evt: "bot.trade_opened", accountId: slot.accountId, symbol: slot.symbol, stake },
        "bot trade opened",
      );
    } catch (err) {
      if (err instanceof DeskRejection && err.reason === "insufficient_funds") {
        await resetDemoBalance(slot.accountId, BOT_DEMO_BALANCE).catch(() => undefined);
      } else if (
        err instanceof Error &&
        err.message.toLowerCase().includes("insufficient")
      ) {
        await resetDemoBalance(slot.accountId, BOT_DEMO_BALANCE).catch(() => undefined);
      }
    }

    // Randomise the asset for the next arrival so bots spread across the book.
    const assetList = this.assets.all();
    if (assetList.length > 0) {
      const next = assetList[Math.floor(this.rng.next() * assetList.length)]!;
      slot.symbol = next.symbol;
      slot.assetId = next.id;
    }

    // Rebalance if balance looks low.
    try {
      const { prisma } = await import("@asm/db");
      const account = await prisma.account.findUnique({
        where: { id: slot.accountId },
        select: { realBalance: true },
      });
      if (account && account.realBalance < MIN_BALANCE_REFILL) {
        await resetDemoBalance(slot.accountId, BOT_DEMO_BALANCE);
      }
    } catch {
      // Non-fatal — bot will try again on next arrival.
    }

    this.scheduleNext(slot);
  }
}
