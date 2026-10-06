import { describe, expect, it } from "vitest";
import { minStakeMinor } from "./currency";

describe("minStakeMinor", () => {
  it("is ₹100 on an INR account", () => {
    expect(minStakeMinor("INR")).toBe(10_000);
  });

  it("is $1 on a USD account", () => {
    expect(minStakeMinor("USD")).toBe(100);
  });
});
