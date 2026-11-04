import { useState } from "react";
import { openSide } from "@asm/client-core";
import type { TradeView } from "@asm/contracts";
import { useSocket } from "@/socket/socket-store";
import { openPnl, type OpenPnl } from "./open-pnl";
import { useNow } from "./useNow";

type Side = ReturnType<typeof openSide>;

export interface LiveTrade {
  /** Seconds left, rounded as the countdown formatter does; never negative. */
  remainingSec: number;
  totalSec: number;
  expired: boolean;
  /** What it pays if it closed now; null while undecided. Frozen at expiry. */
  pnl: OpenPnl | null;
}

/**
 * Countdown and live "if it closed now" figure for ONE open trade. It re-renders each second, so call it only
 * from small leaf components. Ticking stops at expiry. The figure is frozen at that moment (a late tick must not
 * flip it before the settlement arrives) and nothing is settled here: the real outcome comes from the engine.
 * The price is the chart's, so it exists only while the chart shows this trade's market; otherwise `pnl` is null.
 */
export function useLiveTrade(trade: TradeView): LiveTrade {
  const [expired, setExpired] = useState(false);
  const now = useNow(expired ? null : 1000);
  const price = useSocket((s) => (s.chart.symbol === trade.symbol ? s.chart.lastPrice : null));
  const nowSec = now / 1000;
  const reached = nowSec >= trade.expiryTs;

  const [frozen, setFrozen] = useState<{ side: Side } | null>(null);
  const side = openSide(trade.direction, trade.entryPrice, price);
  // Derived state: adjusted during render so the first expired render already holds the frozen figure.
  if (reached && !expired) setExpired(true);
  if (reached && frozen === null) setFrozen({ side });

  const shown = reached ? (frozen?.side ?? side) : side;
  return {
    remainingSec: Math.max(0, trade.expiryTs - nowSec),
    totalSec: trade.expiryTs - trade.entryTs,
    expired: reached,
    pnl: openPnl(trade, shown),
  };
}
