import { describe, expect, it } from "vitest";
import {
  ClaimUsdtPaymentSchema,
  ClaimUtrSchema,
  CreateDepositSchema,
  parseUsdtReceivingAddresses,
  USDT_NETWORK_INFO,
  USDT_NETWORKS,
  isUsdtNetwork,
} from "./deposit";

describe("CreateDepositSchema", () => {
  const valid = { method: "PhonePe", amountInr: 100_000 };

  it("accepts a valid request", () => {
    expect(CreateDepositSchema.parse(valid)).toEqual(valid);
  });

  it("accepts a USDT request with a USDT-cents amount on each network", () => {
    for (const network of USDT_NETWORKS) {
      const usdt = { method: "USDT", network, amountUsdtMinor: 2_500 };
      expect(CreateDepositSchema.parse(usdt)).toEqual(usdt);
    }
  });

  it("rejects a USDT request without a network (never inferred)", () => {
    expect(CreateDepositSchema.safeParse({ method: "USDT", amountUsdtMinor: 2_500 }).success).toBe(false);
  });

  it("rejects an unknown USDT network", () => {
    const r = CreateDepositSchema.safeParse({ method: "USDT", network: "eth", amountUsdtMinor: 2_500 });
    expect(r.success).toBe(false);
  });

  it("rejects a network on a UPI request", () => {
    expect(CreateDepositSchema.safeParse({ ...valid, network: "tron" }).success).toBe(false);
  });

  it("rejects a USDT request carrying an INR amount (each method takes only its own field)", () => {
    expect(
      CreateDepositSchema.safeParse({ method: "USDT", network: "tron", amountInr: 100_000 }).success,
    ).toBe(false);
  });

  it("rejects a client-supplied USD amount", () => {
    expect(CreateDepositSchema.safeParse({ ...valid, amountUsd: 1 }).success).toBe(false);
  });

  it("rejects a client-supplied VPA", () => {
    expect(CreateDepositSchema.safeParse({ ...valid, vpa: "me@bank" }).success).toBe(false);
  });

  it("rejects a client-supplied status", () => {
    expect(CreateDepositSchema.safeParse({ ...valid, status: "COMPLETED" }).success).toBe(false);
  });

  it("rejects an unknown method", () => {
    expect(CreateDepositSchema.safeParse({ ...valid, method: "Cash" }).success).toBe(false);
  });

  it("rejects a fractional amount", () => {
    expect(CreateDepositSchema.safeParse({ ...valid, amountInr: 10.5 }).success).toBe(false);
  });
});

describe("ClaimUtrSchema", () => {
  it("accepts a 12-digit reference", () => {
    expect(ClaimUtrSchema.parse({ utr: "528312345678" }).utr).toBe("528312345678");
  });

  it("trims surrounding whitespace", () => {
    expect(ClaimUtrSchema.parse({ utr: "  528312345678  " }).utr).toBe("528312345678");
  });

  it("rejects a reference that is too short", () => {
    expect(ClaimUtrSchema.safeParse({ utr: "123" }).success).toBe(false);
  });

  it("rejects non-digit characters", () => {
    expect(ClaimUtrSchema.safeParse({ utr: "5283abc45678" }).success).toBe(false);
  });

  it("rejects an injected depositId", () => {
    expect(ClaimUtrSchema.safeParse({ utr: "528312345678", depositId: "other" }).success).toBe(false);
  });
});

describe("USDT networks", () => {
  it("has display metadata for every network", () => {
    expect(USDT_NETWORK_INFO.tron).toEqual({ label: "TRON", standard: "TRC-20", shortLabel: "TRON (TRC-20)" });
    expect(USDT_NETWORK_INFO.bsc.standard).toBe("BEP-20");
    for (const n of USDT_NETWORKS) expect(USDT_NETWORK_INFO[n].shortLabel).toContain(USDT_NETWORK_INFO[n].label);
  });

  it("isUsdtNetwork narrows only known ids", () => {
    expect(isUsdtNetwork("bsc")).toBe(true);
    expect(isUsdtNetwork("BSC")).toBe(false);
    expect(isUsdtNetwork(null)).toBe(false);
  });
});

describe("USDT time slots", () => {
  it("accepts an optional TRON or EVM sender wallet, trimmed, and rejects anything else", () => {
    const base = { method: "USDT", network: "tron", amountUsdtMinor: 2_500 };
    expect(CreateDepositSchema.safeParse(base).success).toBe(true);
    const tron = CreateDepositSchema.safeParse({ ...base, senderAddress: " TL5cUNhJjPSmyZVDncznin7FrSTtea6zUG " });
    expect(tron.success && tron.data.method === "USDT" && tron.data.senderAddress).toBe("TL5cUNhJjPSmyZVDncznin7FrSTtea6zUG");
    expect(CreateDepositSchema.safeParse({ ...base, senderAddress: "0x15e770A42b41f2606538505839042ddFEBACB590" }).success).toBe(true);
    expect(CreateDepositSchema.safeParse({ ...base, senderAddress: "not-a-wallet" }).success).toBe(false);
    expect(CreateDepositSchema.safeParse({ ...base, senderAddress: "" }).success).toBe(false);
  });

  it("reads the rotating address list, falling back to the single address", () => {
    expect(parseUsdtReceivingAddresses(" TA1, TB2 TA1,,TC3 ", "TZ9")).toEqual(["TA1", "TB2", "TC3"]);
    expect(parseUsdtReceivingAddresses("", "TZ9")).toEqual(["TZ9"]);
    expect(parseUsdtReceivingAddresses(undefined, undefined)).toEqual([]);
  });
});
