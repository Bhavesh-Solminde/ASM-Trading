import { describe, expect, it } from "vitest";
import { ClaimUtrSchema } from "@asm/contracts";
import { claimBody, sanitizeUtr, UTR_MAX_LENGTH, utrProblem } from "./utr";

describe("sanitizeUtr", () => {
  it("keeps digits only: a pasted reference with spaces, dashes or a label is cleaned, not rejected", () => {
    expect(sanitizeUtr("4123 4567 8901")).toBe("412345678901");
    expect(sanitizeUtr("UTR: 4123-4567-8901")).toBe("412345678901");
    expect(sanitizeUtr("  ")).toBe("");
  });
  it("drops Devanagari and other-script digits rather than passing them on", () => {
    expect(sanitizeUtr("४१२३४५६७८९०१२")).toBe("");
  });
  it("stops at the longest reference the server takes", () => {
    expect(UTR_MAX_LENGTH).toBe(22);
    expect(sanitizeUtr("1".repeat(30))).toBe("1".repeat(22));
  });
});

describe("utrProblem", () => {
  it("is null for 9 to 22 digits, the server's own range", () => {
    expect(utrProblem("1".repeat(9))).toBeNull();
    expect(utrProblem("412345678901")).toBeNull();
    expect(utrProblem("1".repeat(22))).toBeNull();
  });
  it("says required for nothing, and format for too short or too long", () => {
    expect(utrProblem("")).toBe("required");
    expect(utrProblem("   ")).toBe("required");
    expect(utrProblem("1".repeat(8))).toBe("format");
    expect(utrProblem("1".repeat(23))).toBe("format");
  });
  it("rejects letters and symbols instead of guessing", () => {
    expect(utrProblem("12345678A")).toBe("format");
    expect(utrProblem("1234 5678 9012")).toBe("format");
  });
  it("agrees with the contract the server enforces, for every length", () => {
    for (let n = 0; n <= 30; n++) {
      const utr = "7".repeat(n);
      expect(utrProblem(utr) === null).toBe(ClaimUtrSchema.safeParse({ utr }).success);
    }
  });
});

describe("claimBody", () => {
  it("is exactly the UTR: no screenshot, nothing else the strict contract would refuse", () => {
    expect(claimBody("412345678901")).toEqual({ utr: "412345678901" });
    expect(Object.keys(claimBody("412345678901"))).toEqual(["utr"]);
  });
  it("cleans what was typed before it checks it", () => {
    expect(claimBody("4123 4567 8901")).toEqual({ utr: "412345678901" });
  });
  it("throws for a reference the server would reject, so a bad body is never sent", () => {
    expect(() => claimBody("123")).toThrow();
    expect(() => claimBody("")).toThrow();
  });
});
