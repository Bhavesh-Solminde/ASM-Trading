import { describe, expect, it } from "vitest";
import { ClientMessageSchema, TIMEFRAMES, TIMEFRAME_SEC, TimeframeSchema } from "./ws";

describe("ClientMessageSchema", () => {
  it("accepts an auth message", () => {
    const parsed = ClientMessageSchema.parse({ type: "auth", token: "abc" });
    expect(parsed.type).toBe("auth");
  });

  it("accepts a subscribe message", () => {
    const parsed = ClientMessageSchema.parse({
      type: "subscribe",
      symbol: "AUDNZD_OTC",
      timeframe: "1m",
    });
    expect(parsed.type).toBe("subscribe");
  });

  it("accepts every offered timeframe and rejects unsupported ones", () => {
    for (const tf of TIMEFRAMES) {
      expect(TimeframeSchema.safeParse(tf).success).toBe(true);
    }
    expect(TimeframeSchema.safeParse("2m").success).toBe(false);
    expect(TimeframeSchema.safeParse("1d").success).toBe(false);
  });

  it("maps each offered timeframe to its bucket seconds, ascending", () => {
    expect(TIMEFRAMES).toEqual(["1m", "5m", "15m", "1h"]);
    expect(TIMEFRAME_SEC).toEqual({ "1m": 60, "5m": 300, "15m": 900, "1h": 3600 });
    const secs = TIMEFRAMES.map((t) => TIMEFRAME_SEC[t]);
    expect(secs).toEqual([...secs].sort((a, b) => a - b));
  });

  it("rejects an unknown message type", () => {
    expect(
      ClientMessageSchema.safeParse({ type: "settle", tradeId: "x" }).success,
    ).toBe(false);
  });

  it("rejects extra keys on a subscribe message", () => {
    const result = ClientMessageSchema.safeParse({
      type: "subscribe",
      symbol: "AUDNZD_OTC",
      timeframe: "1m",
      price: 9.99,
    });
    expect(result.success).toBe(false);
  });

  it("rejects an unsupported timeframe", () => {
    expect(
      ClientMessageSchema.safeParse({
        type: "subscribe",
        symbol: "AUDNZD_OTC",
        timeframe: "7s",
      }).success,
    ).toBe(false);
  });

  it("rejects a symbol with unexpected characters", () => {
    expect(
      ClientMessageSchema.safeParse({
        type: "subscribe",
        symbol: "AUD/NZD; DROP TABLE",
        timeframe: "1m",
      }).success,
    ).toBe(false);
  });
});
