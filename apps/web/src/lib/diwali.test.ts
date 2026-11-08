import { describe, expect, it } from "vitest";
import { DIWALI_START, DIWALI_END, isDiwali, diwaliRouteAllowed } from "./diwali";

describe("Diwali eligibility", () => {
  it("includes the India-time start and excludes the end", () => {
    expect(isDiwali(DIWALI_START - 1)).toBe(false);
    expect(isDiwali(DIWALI_START)).toBe(true);
    expect(isDiwali(DIWALI_END - 1)).toBe(true);
    expect(isDiwali(DIWALI_END)).toBe(false);
  });
  it("limits decorations to intended pages", () => {
    for (const path of ["/", "/trade", "/history", "/account", "/account/profile"]) expect(diwaliRouteAllowed(path)).toBe(true);
    for (const path of ["/admin", "/deposit", "/withdrawal", "/checkout/abc", "/account/verify", "/login", "/maintenance", "/trade-fake"]) expect(diwaliRouteAllowed(path)).toBe(false);
  });
});
