import { describe, expect, it } from "vitest";
import { tradeLabel } from "./trade-label";

describe("tradeLabel (the chart's trade-line label)", () => {
  it("counts down while time is left", () => {
    expect(tradeLabel(1008, 1000, "Settling…")).toBe("0:08");
    expect(tradeLabel(1075, 1000, "Settling…")).toBe("1:15");
  });

  it("says Settling… from the expiry on, matching the position strip, never a frozen 0:00", () => {
    expect(tradeLabel(1000, 1000, "Settling…")).toBe("Settling…");
    expect(tradeLabel(1000, 1012, "Settling…")).toBe("Settling…");
  });

  it("still counts in the last second before the expiry", () => {
    expect(tradeLabel(1001, 1000.6, "Settling…")).toBe("0:01");
  });

  it("uses the translated word it is given", () => {
    expect(tradeLabel(1000, 1001, "सेटल हो रहा है…")).toBe("सेटल हो रहा है…");
  });
});
