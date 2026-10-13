import { describe, expect, it } from "vitest";
import { validPixelId } from "./meta-pixel";

describe("validPixelId", () => {
  it("accepts a numeric pixel id", () => {
    expect(validPixelId("1137830615432603")).toBe("1137830615432603");
  });

  it("treats unset or empty as off", () => {
    expect(validPixelId(undefined)).toBeNull();
    expect(validPixelId("")).toBeNull();
  });

  it("rejects anything that is not a bare numeric id", () => {
    expect(validPixelId("1137830615432603&ev=Purchase")).toBeNull();
    expect(validPixelId("abc")).toBeNull();
    expect(validPixelId(" 1137830615432603")).toBeNull();
  });
});
