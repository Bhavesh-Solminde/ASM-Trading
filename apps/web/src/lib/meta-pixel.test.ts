import { describe, expect, it } from "vitest";
import { validPixelIds } from "./meta-pixel";

describe("validPixelIds", () => {
  it("accepts a single numeric pixel id", () => {
    expect(validPixelIds("1137830615432603")).toEqual(["1137830615432603"]);
  });

  it("accepts a comma-separated list, trimming whitespace", () => {
    expect(validPixelIds("1137830615432603, 1176260014975763")).toEqual([
      "1137830615432603",
      "1176260014975763",
    ]);
  });

  it("collapses duplicate ids", () => {
    expect(validPixelIds("1137830615432603,1137830615432603")).toEqual([
      "1137830615432603",
    ]);
  });

  it("treats unset or empty as off", () => {
    expect(validPixelIds(undefined)).toEqual([]);
    expect(validPixelIds("")).toEqual([]);
    expect(validPixelIds(" , ")).toEqual([]);
  });

  it("drops anything that is not a bare numeric id", () => {
    expect(validPixelIds("1137830615432603&ev=Purchase")).toEqual([]);
    expect(validPixelIds("abc,1176260014975763")).toEqual(["1176260014975763"]);
  });
});
