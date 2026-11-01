import { describe, expect, it } from "vitest";
import { ClaimUsdtPaymentSchema } from "@asm/contracts";
import { shownTxHash, txHashHelp, txHashProblem, usdtClaimAvailable, usdtClaimBody, usdtClaimEntry, sanitizeTxHash } from "./usdt-claim";

const HEX = "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90";

describe("sanitizeTxHash", () => {
  it("trims and removes the spaces and line breaks a paste can carry", () => {
    expect(sanitizeTxHash(`  ${HEX}\n`)).toBe(HEX);
    expect(sanitizeTxHash(`${HEX.slice(0, 32)} ${HEX.slice(32)}`)).toBe(HEX);
  });
  it("stops at 0x plus 64 characters", () => {
    expect(sanitizeTxHash("0x" + "a".repeat(80))).toHaveLength(66);
  });
  it("does not rewrite characters: a wrong character must show as a format error, not be hidden", () => {
    expect(sanitizeTxHash("zz-" + "a".repeat(10))).toBe("zz-" + "a".repeat(10));
  });
});

describe("txHashProblem", () => {
  it("is null for 64 hex characters, with or without 0x, in either case", () => {
    expect(txHashProblem(HEX)).toBeNull();
    expect(txHashProblem(`0x${HEX}`)).toBeNull();
    expect(txHashProblem(HEX.toUpperCase())).toBeNull();
  });
  it("says required for nothing, and format for anything else", () => {
    expect(txHashProblem("")).toBe("required");
    expect(txHashProblem("   ")).toBe("required");
    expect(txHashProblem(HEX.slice(1))).toBe("format");
    expect(txHashProblem(`${HEX}0`)).toBe("format");
    expect(txHashProblem("g".repeat(64))).toBe("format");
    expect(txHashProblem(`0x0x${HEX}`)).toBe("format");
  });
  it("agrees with the contract the server enforces", () => {
    for (const text of [HEX, `0x${HEX}`, HEX.slice(1), "g".repeat(64), `${HEX}f`]) {
      expect(txHashProblem(text) === null).toBe(ClaimUsdtPaymentSchema.safeParse({ txHash: text }).success);
    }
  });
});

describe("usdtClaimBody", () => {
  it("is the hash alone, as the server stores it: bare lowercase hex", () => {
    expect(usdtClaimBody(`0x${HEX.toUpperCase()}`)).toEqual({ txHash: HEX });
    expect(usdtClaimBody(` ${HEX} `)).toEqual({ txHash: HEX });
  });
  it("carries no screenshot (the app does not upload one)", () => {
    expect(Object.keys(usdtClaimBody(HEX))).toEqual(["txHash"]);
  });
  it("throws for a hash the server would refuse", () => {
    expect(() => usdtClaimBody("abc")).toThrow();
  });
});

describe("shownTxHash", () => {
  it("shows a BSC hash the way a wallet does, with 0x; a TRON ID bare", () => {
    expect(shownTxHash(HEX, "bsc")).toBe(`0x${HEX}`);
    expect(shownTxHash(`0x${HEX}`, "bsc")).toBe(`0x${HEX}`);
    expect(shownTxHash(HEX, "tron")).toBe(HEX);
    expect(shownTxHash(HEX, null)).toBe(HEX);
  });
});

describe("txHashHelp", () => {
  it("keys the placeholder, hint and format message by network", () => {
    expect(txHashHelp("tron")).toEqual({ placeholder: "usdtClaim.placeholderTron", hint: "usdtClaim.hintTron", format: "usdtClaim.formatTron" });
    expect(txHashHelp("bsc")).toEqual({ placeholder: "usdtClaim.placeholderBsc", hint: "usdtClaim.hintBsc", format: "usdtClaim.formatBsc" });
  });
  it("has a generic set for a network it does not know", () => {
    expect(txHashHelp(null)).toEqual({ placeholder: "usdtClaim.placeholder", hint: "usdtClaim.hint", format: "usdtClaim.formatTron" });
    expect(txHashHelp("eth").placeholder).toBe("usdtClaim.placeholder");
  });
});

describe("usdtClaimAvailable", () => {
  it("is open while the payment is awaiting or has expired, which is exactly when the server takes a hash", () => {
    expect(usdtClaimAvailable("AWAITING_PAYMENT")).toBe(true);
    expect(usdtClaimAvailable("EXPIRED")).toBe(true);
  });
  it("is closed once it is credited, rejected, or being confirmed", () => {
    expect(usdtClaimAvailable("COMPLETED")).toBe(false);
    expect(usdtClaimAvailable("REJECTED")).toBe(false);
    expect(usdtClaimAvailable("PENDING_CONFIRMATION")).toBe(false);
  });
});

describe("usdtClaimEntry", () => {
  const base = { method: "USDT", isGateway: false, status: "AWAITING_PAYMENT" };
  it("offers the link on a manual (shared-address) USDT payment that can still take a hash", () => {
    expect(usdtClaimEntry(base)).toBe(true);
    expect(usdtClaimEntry({ ...base, status: "EXPIRED" })).toBe(true);
  });
  it("never offers it on a gateway deposit (it lands in review on its own) or for UPI", () => {
    expect(usdtClaimEntry({ ...base, isGateway: true })).toBe(false);
    expect(usdtClaimEntry({ ...base, method: "PhonePe" })).toBe(false);
  });
  it("not once the payment is credited or rejected", () => {
    expect(usdtClaimEntry({ ...base, status: "COMPLETED" })).toBe(false);
    expect(usdtClaimEntry({ ...base, status: "REJECTED" })).toBe(false);
  });
});
