import { describe, expect, it } from "vitest";
import { compareVersions } from "./version";

describe("compareVersions", () => {
  it("compares numerically, not as strings", () => {
    expect(compareVersions("1.10.0", "1.9.9")).toBe(1);
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
    expect(compareVersions("0.9.0", "1.0.0")).toBe(-1);
  });
});
