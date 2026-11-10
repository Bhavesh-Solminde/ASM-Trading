/* Public market data for a visual comparison; no trading/account API. */
"use strict";
(() => {
  const PAIRS = {
    btc: { name: "Bitcoin / USD", pair: "btcusd", tick: 0.01, precision: 2, coin: "₿", tv: "BITSTAMP:BTCUSD" },
    eth: { name: "Ethereum / USD", pair: "ethusd", tick: 0.01, precision: 2, coin: "Ξ", tv: "BITSTAMP:ETHUSD" },
    xrp: { name: "XRP / USD", pair: "xrpusd", tick: 0.00001, precision: 5, coin: "X", tv: "BITSTAMP:XRPUSD" },
  };
  function parse(payload) {
    if (!Array.isArray(payload?.data?.ohlc)) throw new Error("The exchange returned no candles.");
    const bars = payload.data.ohlc.map(row => ({ timestamp: Number(row.timestamp) * 1000, open: Number(row.open), high: Number(row.high), low: Number(row.low), close: Number(row.close), volume: Number(row.volume) }));
    if (!bars.length || bars.some(bar => Object.values(bar).some(value => !Number.isFinite(value)) || bar.close <= 0 || bar.volume < 0 || bar.high < Math.max(bar.open, bar.close) || bar.low > Math.min(bar.open, bar.close))) throw new Error("The exchange returned invalid candles.");
    return [...new Map(bars.map(bar => [bar.timestamp, bar])).values()].sort((a, b) => a.timestamp - b.timestamp);
  }
  class LiveMarket {
    constructor(key) { this.config = PAIRS[key]; this.cache = new Map(); this.requests = new Map(); this.last = 0; }
    candles(interval) { return this.cache.get(interval) ?? []; }
    async refresh(interval, initial = false) {
      if (![1, 5, 15, 60].includes(interval)) throw new Error("Unsupported timeframe");
      const cached = this.candles(interval);
      const sequence = (this.requests.get(interval) ?? 0) + 1;
      this.requests.set(interval, sequence);
      const limit = initial || cached.length === 0 ? 500 : 3;
      const response = await fetch(`https://www.bitstamp.net/api/v2/ohlc/${this.config.pair}/?step=${interval * 60}&limit=${limit}`, { signal: AbortSignal.timeout(12000), credentials: "omit", cache: "no-store" });
      if (!response.ok) throw new Error(`Market data is unavailable (${response.status}).`);
      const incoming = parse(await response.json());
      if (this.requests.get(interval) !== sequence) return this.candles(interval);
      // A slow poll must never overwrite a newer timeframe's data or drop
      // retained history. Each interval has its own cache.
      const merged = [...new Map([...this.candles(interval), ...incoming].map(bar => [bar.timestamp, bar])).values()].sort((a, b) => a.timestamp - b.timestamp).slice(-1000);
      this.cache.set(interval, merged);
      this.last = merged.at(-1).close;
      return merged;
    }
  }
  window.AsmLiveFeed = { configs: PAIRS, LiveMarket, parse };
})();
