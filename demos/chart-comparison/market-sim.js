/* A browser-only illustrative order-driven market. No account or production connection. */
"use strict";

class DemoOrderBook {
  constructor(tickSize) {
    this.tickSize = tickSize;
    this.bids = [];
    this.asks = [];
    this.sequence = 0;
    this.fills = 0;
    this.recent = [];
  }

  // Resting orders execute at their own prices. Price first, then FIFO.
  place(side, price, quantity, owner, expiresAt, time) {
    const ticks = Math.max(1, Math.round(price / this.tickSize));
    const opposing = side === "buy" ? this.asks : this.bids;
    const own = side === "buy" ? this.bids : this.asks;
    const fills = [];
    let remaining = quantity;
    while (remaining > 0 && opposing.length) {
      const maker = opposing[0];
      if (side === "buy" ? maker.ticks > ticks : maker.ticks < ticks) break;
      const amount = Math.min(remaining, maker.remaining);
      const fill = { price: maker.ticks * this.tickSize, quantity: amount, side, maker: maker.owner, taker: owner, time };
      fills.push(fill);
      this.recent.unshift(fill);
      this.fills++;
      maker.remaining -= amount;
      remaining -= amount;
      if (maker.remaining === 0) opposing.shift();
    }
    if (remaining > 0) {
      own.push({ ticks, remaining, owner, expiresAt, sequence: this.sequence++ });
      own.sort((a, b) => (side === "buy" ? b.ticks - a.ticks : a.ticks - b.ticks) || a.sequence - b.sequence);
    }
    this.recent.length = Math.min(this.recent.length, 10);
    return fills;
  }

  expire(step) {
    this.bids = this.bids.filter(order => order.expiresAt > step);
    this.asks = this.asks.filter(order => order.expiresAt > step);
  }

  depth(side, count = 7) {
    const levels = [];
    for (const order of side === "buy" ? this.bids : this.asks) {
      const last = levels.at(-1);
      if (last && last.ticks === order.ticks) last.quantity += order.remaining;
      else {
        if (levels.length === count) break;
        levels.push({ ticks: order.ticks, price: order.ticks * this.tickSize, quantity: order.remaining });
      }
    }
    return levels;
  }
}

function demoRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let t = Math.imul(value ^ value >>> 15, 1 | value);
    t ^= t + Math.imul(t ^ t >>> 7, 61 | t);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

class DemoMarket {
  constructor(config, now = Date.now()) {
    this.config = config;
    this.book = new DemoOrderBook(config.tick);
    this.random = demoRandom(config.seed);
    this.last = config.base;
    this.fair = config.base;
    this.velocity = 0;
    this.step = 0;
    this.minutes = [];
    this.lastMinute = 0;
    // Generate the back-history through the same matching path as live ticks.
    // Each warmup sample represents one second of simulated bot activity.
    const currentMinute = Math.floor(now / 60000) * 60000;
    for (let i = 1200 * 60; i > 0; i--) this.advance(currentMinute - i * 1000);
    for (let time = currentMinute; time <= now; time += 1000) this.advance(time);
    this.lastAdvance = now;
  }

  advance(time) {
    this.lastAdvance = time;
    const rnd = this.random;
    const cfg = this.config;
    this.step++;
    this.book.expire(this.step);
    // Bots revise quotes around their own evolving valuation. This does NOT
    // directly set a candle price: only a matched fill may change this.last.
    this.velocity = this.velocity * 0.96 + (rnd() - 0.5) * cfg.tick * 1.4;
    this.fair = Math.max(cfg.tick * 100, this.fair + this.velocity + (rnd() - 0.5) * cfg.tick * 2);
    const allFills = [];
    for (let maker = 0; maker < 6; maker++) {
      const center = this.fair + (rnd() - 0.5) * cfg.tick * 8;
      const spread = (1 + Math.floor(rnd() * 4)) * cfg.tick;
      const size = 1 + Math.floor(rnd() * 9);
      allFills.push(...this.book.place("buy", center - spread, size, `maker-${maker}`, this.step + 5 + maker, time));
      allFills.push(...this.book.place("sell", center + spread, size, `maker-${maker}`, this.step + 5 + maker, time));
    }
    const activity = 3 + Math.floor(rnd() * 5);
    for (let i = 0; i < activity; i++) {
      const agent = Math.floor(rnd() * 54);
      // Noise, trend and mean-reversion agents produce different order flow.
      const buyChance = agent < 18 ? 0.5 : agent < 36
        ? 0.5 + Math.tanh(this.velocity / cfg.tick) * 0.25
        : 0.5 + Math.tanh((this.fair - this.last) / (cfg.tick * 6)) * 0.25;
      const side = rnd() < buyChance ? "buy" : "sell";
      const aggression = Math.floor(rnd() * 15) - 3;
      const price = this.fair + (side === "buy" ? 1 : -1) * aggression * cfg.tick;
      allFills.push(...this.book.place(side, price, 1 + Math.floor(rnd() * 15), `agent-${agent}`, this.step + 4, time));
    }
    const minute = Math.floor(time / 60000) * 60000;
    if (minute !== this.lastMinute) {
      this.lastMinute = minute;
      this.minutes.push({ timestamp: minute, open: this.last, high: this.last, low: this.last, close: this.last, volume: 0 });
      if (this.minutes.length > 1300) this.minutes.shift();
    }
    const candle = this.minutes.at(-1);
    for (const fill of allFills) {
      this.last = Number(fill.price.toFixed(cfg.precision));
      candle.high = Math.max(candle.high, this.last);
      candle.low = Math.min(candle.low, this.last);
      candle.close = this.last;
      candle.volume += fill.quantity;
    }
    return candle;
  }

  candles(interval) {
    const width = interval * 60000;
    const bars = [];
    for (const minute of this.minutes) {
      const timestamp = Math.floor(minute.timestamp / width) * width;
      const last = bars.at(-1);
      if (last && last.timestamp === timestamp) {
        last.high = Math.max(last.high, minute.high);
        last.low = Math.min(last.low, minute.low);
        last.close = minute.close;
        last.volume += minute.volume;
      } else bars.push({ ...minute, timestamp });
    }
    return bars;
  }
}

window.DemoOrderBook = DemoOrderBook;
window.DemoMarket = DemoMarket;
