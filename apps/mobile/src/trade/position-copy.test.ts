import { describe, expect, it } from "vitest";
import { positionCopy } from "./position-copy";

const t = (key: string, opts?: Record<string, unknown>) => (opts ? `${key}|${JSON.stringify(opts)}` : key === "trade.settling" ? "Settling…" : key);
const base = { direction: "DOWN" as const, name: "BTC/USDT", stake: "₹100.00", entryPrice: 94553.6, precision: 2, more: 0 };

describe("positionCopy", () => {
  it("counts down while time is left", () => {
    const c = positionCopy({ ...base, live: { expired: false, remainingSec: 8 } }, t);
    expect(c.time).toBe("0:08");
    expect(c.side).toBe("trade.down");
    expect(c.label.startsWith("trade.positionLabel|")).toBe(true);
    expect(c.label).toContain('"time":"0:08"');
  });

  it("keeps saying Settling… after the expiry until the result arrives (never a frozen 0:00)", () => {
    const c = positionCopy({ ...base, live: { expired: true, remainingSec: 0 } }, t);
    expect(c.time).toBe("Settling…");
    expect(c.label.startsWith("trade.positionLabelSettling|")).toBe(true);
  });

  it("puts the stake at the entry price in the detail line", () => {
    const c = positionCopy({ ...base, live: { expired: false, remainingSec: 8 } }, t);
    expect(c.detail).toBe('trade.at|{"stake":"₹100.00","price":"94,553.60"}');
  });

  it("groups the entry price like the chart's tags", () => {
    const c = positionCopy({ ...base, entryPrice: 1234567.5, precision: 1, live: { expired: false, remainingSec: 8 } }, t);
    expect(c.detail).toContain('"price":"1,234,567.5"');
  });

  it("appends '+N more' to the detail and the spoken label only when others are open", () => {
    const one = positionCopy({ ...base, more: 2, live: { expired: false, remainingSec: 8 } }, t);
    expect(one.detail).toContain(' · trade.moreOpen|{"n":2}');
    expect(one.label).toContain(' trade.moreOpen|{"n":2}');
    const none = positionCopy({ ...base, live: { expired: false, remainingSec: 8 } }, t);
    expect(none.detail).not.toContain("moreOpen");
  });
});
