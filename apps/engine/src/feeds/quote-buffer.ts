import type { Quote } from "./types";

export class QuoteBuffer {
  private readonly buf = new Map<string, Quote>();

  update(quote: Quote): void {
    const existing = this.buf.get(quote.symbol);
    if (existing && existing.ts >= quote.ts) return;
    this.buf.set(quote.symbol, quote);
  }

  latest(symbol: string): Quote | undefined {
    return this.buf.get(symbol);
  }

  latestAll(): Map<string, Quote> {
    return new Map(this.buf);
  }
}
