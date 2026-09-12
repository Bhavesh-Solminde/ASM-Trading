import { describe, expect, it } from "vitest";
import { isAllowedSender, parseSenderList } from "./senders";

describe("parseSenderList", () => {
  it("splits a comma-separated list and uppercases it", () => {
    expect(parseSenderList("iciciB, hdfcbk ,axisbk")).toEqual([
      "ICICIB",
      "HDFCBK",
      "AXISBK",
    ]);
  });

  it("drops empty entries", () => {
    expect(parseSenderList("ICICIB,,  ,HDFCBK")).toEqual(["ICICIB", "HDFCBK"]);
  });

  it("returns an empty list for empty input", () => {
    expect(parseSenderList("")).toEqual([]);
    expect(parseSenderList("   ")).toEqual([]);
  });

  it("de-duplicates entries", () => {
    expect(parseSenderList("ICICIB,icicib")).toEqual(["ICICIB"]);
  });
});

describe("isAllowedSender", () => {
  const allow = ["ICICIB", "HDFCBK"];

  it("matches a DLT header containing an allowed fragment", () => {
    expect(isAllowedSender("AX-ICICIB", allow)).toBe(true);
    expect(isAllowedSender("VM-HDFCBK-S", allow)).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isAllowedSender("ax-icicib", allow)).toBe(true);
  });

  it("rejects an unlisted sender", () => {
    expect(isAllowedSender("JD-AMAZON", allow)).toBe(false);
  });

  it("rejects everything when the allowlist is empty", () => {
    expect(isAllowedSender("AX-ICICIB", [])).toBe(false);
  });

  it("rejects a blank sender", () => {
    expect(isAllowedSender("", allow)).toBe(false);
  });
});
