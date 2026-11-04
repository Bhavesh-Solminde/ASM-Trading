import { describe, expect, it } from "vitest";
import { stakeProblemText } from "./stake-problem";

// A fake t that shows which key and params were asked for.
const t = (key: string, opts?: Record<string, unknown>) => (opts ? `${key}|${JSON.stringify(opts)}` : key);

describe("stakeProblemText", () => {
  it("is null for a valid stake and for an empty one (nothing to complain about yet)", () => {
    expect(stakeProblemText({ ok: true, minor: 10000 }, "INR", t)).toBeNull();
    expect(stakeProblemText({ ok: false, reason: "empty" }, "INR", t)).toBeNull();
  });

  it("names the minimum with the money format", () => {
    const text = stakeProblemText({ ok: false, reason: "min" }, "INR", t);
    expect(text).toContain("trade.minStake");
    expect(text).toContain("₹100.00");
  });

  it("names the maximum", () => {
    expect(stakeProblemText({ ok: false, reason: "max" }, "INR", t)).toContain("trade.maxStake");
  });

  it("says insufficient balance without params", () => {
    expect(stakeProblemText({ ok: false, reason: "balance" }, "INR", t)).toBe("trade.insufficient");
  });
});
