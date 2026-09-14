import { describe, expect, it } from "vitest";
import { expirySecFor } from "./expiry";

describe("expirySecFor", () => {
  it("keeps an exact whole second", () => {
    expect(expirySecFor(1_757_534_400_000)).toBe(1_757_534_400);
  });

  it("rounds any fraction of a second up, so no trade settles early", () => {
    expect(expirySecFor(1_757_534_400_001)).toBe(1_757_534_401);
    expect(expirySecFor(1_757_534_400_999)).toBe(1_757_534_401);
  });
});
