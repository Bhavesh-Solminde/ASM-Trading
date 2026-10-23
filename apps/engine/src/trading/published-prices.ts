/** Execution prices must come from ticks actually published to the chart. */
export class PublishedPrices {
  private readonly prices = new Map<string, { price: number; ts: number }>();

  record(symbol: string, price: number, ts: number): void {
    if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(ts)) {
      throw new Error("Invalid published price");
    }
    this.prices.set(symbol, { price, ts });
  }

  latest(symbol: string, nowSec = Date.now() / 1000): number {
    const quote = this.prices.get(symbol);
    // Fail closed before the first tick or when the engine stops publishing.
    if (!quote || nowSec - quote.ts > 15 || quote.ts > nowSec + 1) return 0;
    return quote.price;
  }
}
