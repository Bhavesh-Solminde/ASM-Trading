import { describe, expect, it } from "vitest";
import { moneyFromMinor } from "./format";

describe("moneyFromMinor", () => {
  it("renders an INR amount with the rupee sign and Indian grouping", () => {
    expect(moneyFromMinor(5_000_000, "INR")).toBe("₹50,000.00");
  });

  it("renders a USD amount in dollars, not rupees (50,000 cents is $500.00)", () => {
    expect(moneyFromMinor(50_000, "USD")).toBe("$500.00");
  });

  it("falls back to the dollar format for any other currency code the app might hold", () => {
    expect(moneyFromMinor(12_345, "USDT")).toBe("$123.45");
  });
});
