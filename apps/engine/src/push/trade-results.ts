import type { ServerMessage, TradeView } from "@asm/contracts";
import { logger } from "@asm/logger";
import type { Notifier } from "../trading/trade-desk";

export interface TradeResult {
  symbol: string;
  pnl: number;
  stake: number;
  currency: string;
  displayName?: string;
}

interface Deps {
  isOnline: (userId: string) => boolean;
  liveAccounts: (ids: string[]) => Promise<Map<string, string>>;
  prefs: (userId: string) => Promise<{ notifyTrades: boolean; isBot: boolean }>;
  send: (userId: string, results: TradeResult[]) => Promise<void>;
  windowMs?: number;
  settledResults?: (ids: string[]) => Promise<TradeResult[]>;
}

export class TradeResultBatcher {
  private readonly pending = new Map<string, { trades: TradeView[]; timer: ReturnType<typeof setTimeout> }>();

  constructor(private readonly deps: Deps) {}

  add(userId: string, trade: TradeView): void {
    const entry = this.pending.get(userId);
    if (entry) {
      if (!entry.trades.some((t) => t.id === trade.id)) entry.trades.push(trade);
      return;
    }
    const timer = setTimeout(() => void this.flush(userId), this.deps.windowMs ?? 10_000);
    this.pending.set(userId, { trades: [trade], timer });
  }

  async flushAll(): Promise<void> {
    await Promise.all([...this.pending.keys()].map((u) => this.flush(u)));
  }

  private async flush(userId: string): Promise<void> {
    const entry = this.pending.get(userId);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.pending.delete(userId);
    try {
      if (this.deps.isOnline(userId)) return;
      const prefs = await this.deps.prefs(userId);
      if (!prefs.notifyTrades || prefs.isBot) return;
      let results: TradeResult[];
      if (this.deps.settledResults) results = await this.deps.settledResults(entry.trades.map((t) => t.id));
      else {
        const live = await this.deps.liveAccounts([...new Set(entry.trades.map((t) => t.accountId))]);
        results = entry.trades.filter((t) => live.has(t.accountId)).map((t) => ({ symbol: t.symbol, pnl: t.pnl, stake: t.stake, currency: live.get(t.accountId)! }));
      }
      // A user can reconnect while preferences/DB reads are in flight.
      if (this.deps.isOnline(userId)) return;
      if (results.length) await this.deps.send(userId, results);
    } catch (err) {
      logger.error({ evt: "push.trade_results_failed", userId, errorType: err instanceof Error ? err.name : "unknown" }, "trade result push failed");
    }
  }
}

/** Passes engine messages through unchanged and feeds settlements to the batcher. */
export function withTradeResultPush(inner: Notifier, batcher: TradeResultBatcher): Notifier {
  return {
    sendToUser(userId: string, message: ServerMessage) {
      inner.sendToUser(userId, message);
      if (message.type === "trade:settled") batcher.add(userId, message.trade);
    },
    broadcast(symbol: string, message: ServerMessage) {
      inner.broadcast(symbol, message);
    },
  };
}
