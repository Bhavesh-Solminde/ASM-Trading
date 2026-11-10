import { applyChartMessage, initialChartState, type ChartState } from "@asm/client-core";
import type { ServerMessage, Timeframe } from "@asm/contracts";

/** Six recent selections. Only selected data is reduced; restart generations invalidate every cached cursor. */
export class ChartStream {
  private cache = new Map<string, ChartState>();
  private generation: string | undefined;
  state = initialChartState("", "1m");

  select(symbol: string, timeframe: Timeframe) {
    if (this.state.symbol === symbol && this.state.timeframe === timeframe) return this.state;
    if (this.state.symbol) {
      const key = `${this.state.symbol}:${this.state.timeframe}`;
      this.cache.delete(key);
      this.cache.set(key, { ...this.state, displayQuote: null, loadingOlder: false });
      while (this.cache.size > 6) this.cache.delete(this.cache.keys().next().value!);
    }
    this.state = this.cache.get(`${symbol}:${timeframe}`) ?? initialChartState(symbol, timeframe);
    return this.state;
  }

  apply(message: ServerMessage) {
    if (message.type === "ready" && message.generation) {
      if (this.generation && this.generation !== message.generation) this.reset();
      this.generation = message.generation;
    }
    if (message.type === "otc:market" && ((!message.reset && !this.state.generation) || (this.generation && this.generation !== message.generation))) return this.state;
    this.state = applyChartMessage(this.state, message);
    return this.state;
  }

  cursor(symbol: string, timeframe: Timeframe) {
    const s = this.state;
    if (s.symbol !== symbol || s.timeframe !== timeframe || !s.generation) return {};
    const since = s.forming?.openTs ?? s.candles.at(-1)?.openTs;
    return since === undefined ? {} : { generation: s.generation, since };
  }

  reset() {
    this.cache.clear();
    this.generation = undefined;
    this.state = initialChartState(this.state.symbol, this.state.timeframe);
    return this.state;
  }
}
