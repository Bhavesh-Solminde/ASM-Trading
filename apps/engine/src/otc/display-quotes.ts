import { randomUUID } from "node:crypto";
import { OtcRejected } from "@asm/db";
import type { OtcDisplayQuote } from "@asm/contracts";

const QUOTE_LIFETIME_MS = 5000;
const MAX_QUOTES = 4096;

/** Opaque quote IDs bind a displayed price to this running market instance. */
export class DisplayQuotes {
  private quotes = new Map<string, OtcDisplayQuote & { symbol:string }>();
  private latest = new Map<string, OtcDisplayQuote>();

  issue(symbol:string, price:number|null, precision:number, now=Date.now()):OtcDisplayQuote|null {
    if (price === null || !Number.isFinite(price) || price <= 0) return null;
    const rounded = Number(price.toFixed(precision));
    const previous = this.latest.get(symbol);
    if (previous?.price === rounded && this.quotes.has(previous.token)
      && previous.expiresAt - now > QUOTE_LIFETIME_MS / 2) return previous;
    const quote = { token:randomUUID(), price:rounded, expiresAt:now + QUOTE_LIFETIME_MS };
    this.quotes.set(quote.token, {...quote, symbol});
    this.latest.set(symbol, quote);
    for (const [token, saved] of this.quotes) {
      if (saved.expiresAt >= now && this.quotes.size <= MAX_QUOTES) break;
      this.quotes.delete(token);
    }
    return quote;
  }

  resolve(token:string|undefined, symbol:string, receivedAt:number):number {
    const quote = token ? this.quotes.get(token) : undefined;
    if (!quote || quote.symbol !== symbol || receivedAt > quote.expiresAt
      || receivedAt < quote.expiresAt - QUOTE_LIFETIME_MS) throw new OtcRejected("display_quote_expired");
    return quote.price;
  }
}
