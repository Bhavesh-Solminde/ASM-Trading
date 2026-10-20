import { describe, expect, it } from "vitest";
import { brandKey } from "./method-key";

describe("brandKey", () => {
  it("maps the server's method labels to a logo key", () => {
    expect(brandKey("PhonePe")).toBe("PhonePe");
    expect(brandKey("Gpay")).toBe("Gpay");
    expect(brandKey("PayTM")).toBe("PayTM");
    expect(brandKey("UPI")).toBe("UPI");
  });
  it("reads a USDT label with its network suffix", () => {
    expect(brandKey("USDT")).toBe("USDT");
    expect(brandKey("USDT (TRC-20)")).toBe("USDT");
  });
  it("sends the any-app choice to the UPI logo", () => {
    expect(brandKey("any")).toBe("UPI");
  });
  it("has no logo for a bank transfer or an old label", () => {
    expect(brandKey("Bank transfer")).toBeNull();
    expect(brandKey("UPI Intent")).toBe("UPI");
    expect(brandKey("")).toBeNull();
  });
});
