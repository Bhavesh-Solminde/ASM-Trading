import { createRng, type Rng } from "@asm/pricing";
import { DURATIONS_SEC } from "@asm/trading";
import { prisma } from "@asm/db";
import { logger } from "@asm/logger";
import type { TradeDesk } from "../trading/trade-desk";
import type { AssetRegistry } from "../assets/registry";
import {
  chooseDirection,
  chooseStake,
  pickProfile,
  type BotProfile,
} from "./profiles";

const BOT_COUNT = Number(process.env.BOT_COUNT ?? 40);
const ARRIVALS_PER_MINUTE = Number(process.env.BOT_ARRIVALS_PER_MINUTE ?? 90);
const BOT_EMAIL_PREFIX = "bot+";
const SHORT_DURATIONS = DURATIONS_SEC.filter((d) => d >= 30 && d <= 300);

interface Bot {
  userId: string;
  accountId: string;
  profile: BotProfile;
  lastStake: number;
  lastLost: boolean;
}

/**
 * Simulates a crowd of ordinary traders so the book always has exposure to
 * lean against. Bots open trades through `TradeDesk.open()` — the same path
 * a real user's browser call takes — so nothing downstream needs to know the
 * difference.
 */
export class BotCrowd {
  private bots: Bot[] = [];
  private rng: Rng;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly assets: AssetRegistry,
    private readonly desk: TradeDesk,
    seed: number,
  ) {
    this.rng = createRng(seed);
  }

  async provision(): Promise<void> {
    for (let i = 0; i < BOT_COUNT; i++) {
      const email = `${BOT_EMAIL_PREFIX}${i}@asmtrade.local`;
      const user = await prisma.user.upsert({
        where: { email },
        update: {},
        create: { email, passwordHash: "bot-no-login", emailVerified: true },
      });

      const account = await prisma.account.upsert({
        where: { userId_type: { userId: user.id, type: "DEMO" } },
        update: {},
        create: { userId: user.id, type: "DEMO", realBalance: 100_000_000 },
      });

      this.bots.push({
        userId: user.id,
        accountId: account.id,
        profile: pickProfile(this.rng.next()),
        lastStake: 2_000,
        lastLost: false,
      });
    }

    logger.info(
      { evt: "engine.bots_provisioned", count: this.bots.length },
      "bot crowd provisioned",
    );
  }

  start(): void {
    const intervalMs = Math.max(200, Math.round(60_000 / ARRIVALS_PER_MINUTE));
    this.timer = setInterval(() => void this.arrive(), intervalMs);
    logger.info(
      { evt: "engine.bots_started", arrivalsPerMinute: ARRIVALS_PER_MINUTE },
      "bot crowd started",
    );
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async arrive(): Promise<void> {
    const bot = this.bots[Math.floor(this.rng.next() * this.bots.length)];
    if (!bot) return;

    const all = this.assets.all();
    const asset = all[Math.floor(this.rng.next() * all.length)];
    if (!asset) return;

    const recentCandle = asset.aggregators.get("1m")?.current() ?? null;
    const recent = recentCandle ? [recentCandle.o, recentCandle.c] : [];

    const direction = chooseDirection(bot.profile, recent, this.rng.next());

    let stake = chooseStake(bot.profile, this.rng.next(), this.rng.next());
    if (bot.profile === "MARTINGALE" && bot.lastLost) {
      stake = Math.min(bot.lastStake * 2, 20_000_000);
    }
    bot.lastStake = stake;

    const durationSec =
      SHORT_DURATIONS[Math.floor(this.rng.next() * SHORT_DURATIONS.length)]!;

    try {
      await this.desk.open({
        accountId: bot.accountId,
        actorId: bot.userId,
        symbol: asset.symbol,
        direction,
        stake,
        durationSec,
      });
    } catch {
      await prisma.account
        .update({
          where: { id: bot.accountId },
          data: { realBalance: 100_000_000 },
        })
        .catch(() => {});
    }
  }
}
