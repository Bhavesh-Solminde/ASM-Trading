import { describe, expect, it } from "vitest";
import { DEPOSIT_QUICK_INR } from "@asm/client-core";
import type { DepositConfig } from "@asm/contracts";
import {
  DEPOSIT_AMOUNT_OPTS,
  RECOMMENDED_NETWORK,
  bonusPreview,
  chooseMethod,
  depositBody,
  depositModel,
  limitProblem,
  methodRows,
  networkFor,
  parseRupees,
  quickAmounts,
} from "./deposit-form";

const config: DepositConfig = { upiEnabled: true, usdtNetworks: ["tron"], gatewayNetworks: [], completedDeposits: 0, bonusTiers: [100, 100, 50, 50] };
const withConfig = (patch: Partial<DepositConfig>): DepositConfig => ({ ...config, ...patch });

describe("parseRupees", () => {
  it("reads whole rupees and treats anything else as nothing entered", () => {
    expect(parseRupees("2000")).toBe(2000);
    expect(parseRupees("007")).toBe(7);
    expect(parseRupees("")).toBe(0);
    expect(parseRupees("12.5")).toBe(0);
    expect(parseRupees("1e5")).toBe(0);
    expect(parseRupees("-5")).toBe(0);
  });
  it("never returns a number past the safe-integer range", () => {
    expect(parseRupees("9".repeat(20))).toBe(0);
  });
});

describe("DEPOSIT_AMOUNT_OPTS", () => {
  it("keeps whole rupees only, and caps the digits so the figure cannot outgrow the screen", () => {
    expect(DEPOSIT_AMOUNT_OPTS.decimals).toBe(false);
    expect(DEPOSIT_AMOUNT_OPTS.maxInt).toBe(8);
  });
});

describe("limitProblem", () => {
  it("is null while nothing is entered", () => {
    expect(limitProblem("PhonePe", 0)).toBeNull();
    expect(limitProblem("USDT", 0)).toBeNull();
  });
  it("reports the UPI minimum and maximum in rupees", () => {
    expect(limitProblem("PhonePe", 400)).toEqual({ kind: "min", rupees: 500 });
    expect(limitProblem("PhonePe", 500)).toBeNull();
    expect(limitProblem("Gpay", 10_00_000)).toBeNull();
    expect(limitProblem("Gpay", 10_00_001)).toEqual({ kind: "max", rupees: 10_00_000 });
  });
  it("reports the USDT limits in rupees ($10 to $10,000 at ₹110 = $1)", () => {
    expect(limitProblem("USDT", 1_000)).toEqual({ kind: "min", rupees: 1_100 });
    expect(limitProblem("USDT", 1_100)).toBeNull();
    expect(limitProblem("USDT", 11_00_000)).toBeNull();
    expect(limitProblem("USDT", 11_00_001)).toEqual({ kind: "max", rupees: 11_00_000 });
  });
});

describe("methodRows", () => {
  it("offers the five methods in order", () => {
    expect(methodRows(config, 1000).map((r) => r.method)).toEqual(["PhonePe", "Gpay", "PayTM", "UPI", "USDT"]);
  });
  it("marks every UPI method coming soon while UPI deposits are off, and leaves USDT alone", () => {
    const rows = methodRows(withConfig({ upiEnabled: false }), 2000);
    expect(rows.filter((r) => r.state === "soon").map((r) => r.method)).toEqual(["PhonePe", "Gpay", "PayTM", "UPI"]);
    expect(rows.find((r) => r.method === "USDT")?.state).toBe("ok");
  });
  it("hides USDT when no network is configured", () => {
    expect(methodRows(withConfig({ usdtNetworks: [] }), 1000).map((r) => r.method)).not.toContain("USDT");
  });
  it("marks a method whose limits exclude the amount, with the limit it hit", () => {
    const at400 = methodRows(config, 400);
    expect(at400.find((r) => r.method === "PhonePe")).toEqual({ method: "PhonePe", state: "limit", limit: { kind: "min", rupees: 500 } });
    const at900 = methodRows(config, 900);
    expect(at900.find((r) => r.method === "PhonePe")?.state).toBe("ok");
    expect(at900.find((r) => r.method === "USDT")).toEqual({ method: "USDT", state: "limit", limit: { kind: "min", rupees: 1_100 } });
  });
  it("puts no limit on any method while nothing is entered", () => {
    expect(methodRows(config, 0).every((r) => r.state === "ok" && r.limit === null)).toBe(true);
  });
  it("lets coming soon win over a limit, and carries no English text", () => {
    const rows = methodRows(withConfig({ upiEnabled: false }), 400);
    expect(rows[0]).toEqual({ method: "PhonePe", state: "soon", limit: null });
    expect(JSON.stringify(rows)).not.toMatch(/Minimum|Maximum|Coming/);
  });
});

describe("chooseMethod", () => {
  const rows = methodRows(config, 1000);
  it("defaults to the first method that can take the amount", () => {
    expect(chooseMethod(rows, null)).toBe("PhonePe");
    expect(chooseMethod(methodRows(withConfig({ upiEnabled: false }), 1000), null)).toBe("USDT");
  });
  it("keeps the user's pick", () => {
    expect(chooseMethod(rows, "Gpay")).toBe("Gpay");
  });
  it("keeps a picked method that the amount has just pushed past its limit, so the limit message shows for it", () => {
    expect(chooseMethod(methodRows(config, 900), "USDT")).toBe("USDT");
  });
  it("drops a picked method that is coming soon", () => {
    expect(chooseMethod(methodRows(withConfig({ upiEnabled: false }), 1000), "Gpay")).toBe("USDT");
  });
  it("falls back to the first limited method when none can take the amount, and to null when nothing is offered", () => {
    expect(chooseMethod(methodRows(config, 400), null)).toBe("PhonePe");
    expect(chooseMethod(methodRows(withConfig({ upiEnabled: false, usdtNetworks: [] }), 1000), null)).toBeNull();
  });
});

describe("networkFor", () => {
  it("is null when USDT is not offered", () => {
    expect(networkFor(withConfig({ usdtNetworks: [] }), null)).toBeNull();
  });
  it("preselects the recommended network (as the website does) when it is offered", () => {
    expect(RECOMMENDED_NETWORK).toBe("bsc");
    expect(networkFor(withConfig({ usdtNetworks: ["tron", "bsc"] }), null)).toBe("bsc");
  });
  it("takes the only network, or the first, when the recommended one is not offered", () => {
    expect(networkFor(config, null)).toBe("tron");
  });
  it("keeps the user's pick while it is still offered", () => {
    const both = withConfig({ usdtNetworks: ["tron", "bsc"] });
    expect(networkFor(both, "tron")).toBe("tron");
    expect(networkFor(config, "bsc")).toBe("tron");
  });
});

describe("quickAmounts", () => {
  it("is the shared quick picks when every method is on", () => {
    expect(quickAmounts(config)).toEqual([...DEPOSIT_QUICK_INR]);
  });
  it("drops picks that no method on offer can take (USDT-only starts at ₹1,100)", () => {
    expect(quickAmounts(withConfig({ upiEnabled: false }))).toEqual([2000, 5000]);
  });
  it("still offers the UPI picks while UPI is off and there is no USDT, so the screen is never empty", () => {
    expect(quickAmounts(withConfig({ upiEnabled: false, usdtNetworks: [] }))).toEqual([...DEPOSIT_QUICK_INR]);
  });
});

describe("bonusPreview", () => {
  it("is the next tier for the user's next deposit, with the bonus in paise", () => {
    expect(bonusPreview(config, 2000)).toEqual({ nth: 1, pct: 100, bonusMinor: 200_000 });
    expect(bonusPreview(withConfig({ completedDeposits: 2 }), 2000)).toEqual({ nth: 3, pct: 50, bonusMinor: 100_000 });
  });
  it("floors the bonus exactly as the server does", () => {
    expect(bonusPreview(withConfig({ completedDeposits: 2 }), 1001)).toEqual({ nth: 3, pct: 50, bonusMinor: 50_050 });
  });
  it("is 0 while nothing is entered, and null once every tier is used", () => {
    expect(bonusPreview(config, 0)).toEqual({ nth: 1, pct: 100, bonusMinor: 0 });
    expect(bonusPreview(withConfig({ completedDeposits: 4 }), 2000)).toBeNull();
    expect(bonusPreview(withConfig({ completedDeposits: 9 }), 2000)).toBeNull();
  });
});

describe("depositBody", () => {
  it("sends UPI amounts in paise", () => {
    expect(depositBody("PhonePe", 1000)).toEqual({ method: "PhonePe", amountInr: 100_000 });
    expect(depositBody("UPI", 500)).toEqual({ method: "UPI", amountInr: 50_000 });
  });
  it("sends USDT in USDT cents (₹110 = $1, so ₹1.10 is one cent) with the network", () => {
    expect(depositBody("USDT", 2000, "tron")).toEqual({ method: "USDT", network: "tron", amountUsdtMinor: 1818 });
    expect(depositBody("USDT", 1234, "bsc")).toEqual({ method: "USDT", network: "bsc", amountUsdtMinor: 1122 });
  });
  it("refuses a USDT deposit with no network, and an amount the contract rejects", () => {
    expect(() => depositBody("USDT", 2000)).toThrow();
    expect(() => depositBody("PhonePe", 0)).toThrow();
  });
});

describe("depositModel", () => {
  const model = (amountText: string, over: Partial<{ config: DepositConfig; method: "PhonePe" | "Gpay" | "PayTM" | "UPI" | "USDT" | null; network: "tron" | "bsc" | null }> = {}) =>
    depositModel(over.config ?? config, { amountText, method: over.method ?? null, network: over.network ?? null });

  it("cannot pay while nothing is entered, and shows no problem for it", () => {
    const m = model("");
    expect(m.canPay).toBe(false);
    expect(m.problem).toBeNull();
    expect(m.rupees).toBe(0);
    expect(m.method).toBe("PhonePe");
  });
  it("can pay a valid amount with the default method", () => {
    const m = model("2000");
    expect(m).toMatchObject({ canPay: true, method: "PhonePe", problem: null, rupees: 2000, network: "tron" });
    expect(m.bonus).toEqual({ nth: 1, pct: 100, bonusMinor: 200_000 });
    expect(m.quick).toEqual([...DEPOSIT_QUICK_INR]);
  });
  it("cannot pay below the minimum, and says which limit", () => {
    expect(model("400")).toMatchObject({ canPay: false, method: "PhonePe", problem: { kind: "min", rupees: 500 } });
  });
  it("cannot pay above the maximum", () => {
    expect(model("1100001")).toMatchObject({ canPay: false, problem: { kind: "max", rupees: 10_00_000 } });
  });
  it("keeps a picked USDT that the amount has pushed under its minimum, blocked with its own limit", () => {
    expect(model("900", { method: "USDT" })).toMatchObject({ canPay: false, method: "USDT", problem: { kind: "min", rupees: 1_100 } });
  });
  it("can pay USDT only with a network", () => {
    expect(model("2000", { method: "USDT" })).toMatchObject({ canPay: true, network: "tron" });
    expect(model("2000", { method: "USDT", config: withConfig({ usdtNetworks: ["tron", "bsc"] }) }).network).toBe("bsc");
  });
  it("cannot pay when nothing is on offer", () => {
    const off = withConfig({ upiEnabled: false, usdtNetworks: [] });
    expect(model("2000", { config: off })).toMatchObject({ canPay: false, method: null });
  });
});
