import { describe, expect, it } from "vitest";
import { ClientMessageSchema } from "./ws";

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
