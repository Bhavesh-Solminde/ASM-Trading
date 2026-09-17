import type { ServerMessage } from "@asm/contracts";

export interface Quote {
  readonly price: number | null;
  /** The price before the latest tick; drives the up/down tick flash. */
  readonly prevPrice: number | null;
  /** Oldest price in the loaded history; the tape's change % is measured from it. */
  readonly refPrice: number | null;
  readonly payoutPct: number;
}

export type Quotes = Readonly<Record<string, Quote>>;

export function initialQuotes(assets: readonly { symbol: string; payoutPct: number }[]): Quotes {
  return Object.fromEntries(
    assets.map((a) => [a.symbol, { price: null, prevPrice: null, refPrice: null, payoutPct: a.payoutPct }]),
  );
}

/** Folds one server message into the ticker quotes. Unknown symbols are ignored. */
export function applyQuoteMessage(quotes: Quotes, message: ServerMessage): Quotes {
  switch (message.type) {
    case "tick": {
      const q = quotes[message.symbol];
      if (!q || q.price === message.price) return quotes;
      return {
        ...quotes,
        [message.symbol]: {
          ...q,
          prevPrice: q.price,
          price: message.price,
          refPrice: q.refPrice ?? message.price,
        },
      };
    }
    case "candles:history": {
      const q = quotes[message.symbol];
      const first = message.candles[0];
      const last = message.candles.at(-1);
      if (!q || !first || !last) return quotes;
      return { ...quotes, [message.symbol]: { ...q, refPrice: first.o, price: q.price ?? last.c } };
    }
    case "payout:update": {
      const q = quotes[message.symbol];
      if (!q || q.payoutPct === message.payoutPct) return quotes;
      return { ...quotes, [message.symbol]: { ...q, payoutPct: message.payoutPct } };
    }
    default:
      return quotes;
  }
}

export function changePct(q: Quote): number | null {
  if (q.price === null || q.refPrice === null || q.refPrice === 0) return null;
  return ((q.price - q.refPrice) / q.refPrice) * 100;
}

export function tickDirection(q: Quote): "up" | "down" | null {
  if (q.price === null || q.prevPrice === null || q.price === q.prevPrice) return null;
  return q.price > q.prevPrice ? "up" : "down";
}
