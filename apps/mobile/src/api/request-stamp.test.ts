import { describe, expect, it } from "vitest";
import { latestStamp } from "./request-stamp";

describe("latestStamp", () => {
  it("moves forward", () => {
    expect(latestStamp(100, 200)).toBe(200);
  });
  it("never moves backwards when an older request resolves late", () => {
    expect(latestStamp(200, 100)).toBe(200);
  });
});
