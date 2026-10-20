import { describe, expect, it } from "vitest";
import { hubBalances, RECENT_LIMIT, showKycNextStep } from "./hub-model";

const live = { id: "live-1", currency: "INR", realBalance: 1_000_00, bonusBalance: 200_00 };

describe("hubBalances", () => {
  it("takes the total from the socket balance for the live account when it has one", () => {
    const b = hubBalances({ live, socket: { realBalance: 1_500_00, bonusBalance: 100_00 }, withdrawable: 1_000_00, lockedBonus: 200_00 });
    expect(b).toEqual({ currency: "INR", totalMinor: 1_600_00, withdrawableMinor: 1_000_00, bonusMinor: 100_00 });
  });
  it("falls back to the wallet when the socket has nothing for the account", () => {
    const b = hubBalances({ live, socket: undefined, withdrawable: 900_00, lockedBonus: 200_00 });
    expect(b).toEqual({ currency: "INR", totalMinor: 1_200_00, withdrawableMinor: 900_00, bonusMinor: 200_00 });
  });
  it("never shows more withdrawable than the real balance the socket reports", () => {
    const b = hubBalances({ live, socket: { realBalance: 400_00, bonusBalance: 0 }, withdrawable: 1_000_00, lockedBonus: 0 });
    expect(b?.withdrawableMinor).toBe(400_00);
  });
  it("shows the total before the wallet's own figures arrive, with those lines unknown", () => {
    const b = hubBalances({ live, socket: { realBalance: 500_00, bonusBalance: 0 }, withdrawable: undefined, lockedBonus: undefined });
    expect(b).toEqual({ currency: "INR", totalMinor: 500_00, withdrawableMinor: null, bonusMinor: 0 });
  });
  it("is null without a live account", () => {
    expect(hubBalances({ live: undefined, socket: undefined, withdrawable: 1, lockedBonus: 1 })).toBeNull();
  });
});

describe("showKycNextStep", () => {
  it("shows the verify card only before verification starts or after a rejection", () => {
    expect(showKycNextStep("NOT_STARTED")).toBe(true);
    expect(showKycNextStep("REJECTED")).toBe(true);
    expect(showKycNextStep("PENDING")).toBe(false);
    expect(showKycNextStep("VERIFIED")).toBe(false);
    expect(showKycNextStep(undefined)).toBe(false);
  });
});

describe("RECENT_LIMIT", () => {
  it("is 5", () => {
    expect(RECENT_LIMIT).toBe(5);
  });
});
