import { describe, expect, it } from "vitest";
import type { TradeView } from "@asm/contracts";
import { RING_LENGTH, ringOffset, shortCountdown, soonestOpen } from "./position";
import { openSide } from "./pnl-display";
import { EXPIRY_CHIPS, formatDuration, isChipExpiry, profitForStake, stakeToMinor } from "./stake";

function trade(id: string, expiryTs: number, status: TradeView["status"] = "OPEN"): TradeView {
  return {
    id,
    accountId: "a",
    symbol: "X",
    direction: "UP",
    stake: 10_000,
    payoutPct: 93,
    entryPrice: 100,
    entryTs: 0,
    expiryTs,
    exitPrice: null,
    status,
    pnl: 0,
  };
}

describe("shortCountdown", () => {
  it("formats m:ss and h:mm:ss, rounding up", () => {
    expect(shortCountdown(30)).toBe("0:30");
    expect(shortCountdown(29.2)).toBe("0:30");
    expect(shortCountdown(300)).toBe("5:00");
    expect(shortCountdown(3725)).toBe("1:02:05");
    expect(shortCountdown(-4)).toBe("0:00");
  });
});

describe("ringOffset", () => {
  it("is empty-offset when full and a full circumference when out of time", () => {
    expect(ringOffset(30, 30)).toBe(0);
    expect(ringOffset(0, 30)).toBeCloseTo(RING_LENGTH);
    expect(ringOffset(15, 30)).toBeCloseTo(RING_LENGTH / 2);
    expect(ringOffset(5, 0)).toBeCloseTo(RING_LENGTH);
  });
});

describe("soonestOpen", () => {
  it("picks the earliest expiry among open trades and counts the rest", () => {
    const r = soonestOpen([trade("a", 90), trade("b", 40), trade("c", 10, "WON"), trade("d", 70)]);
    expect(r?.trade.id).toBe("b");
    expect(r?.more).toBe(2);
  });
  it("is null with no open trades", () => {
    expect(soonestOpen([trade("a", 10, "LOST")])).toBeNull();
  });
});

describe("openSide", () => {
  it("reads the live price against the entry for each direction", () => {
    expect(openSide("UP", 100, 101)).toBe("winning");
    expect(openSide("UP", 100, 99)).toBe("losing");
    expect(openSide("DOWN", 100, 99)).toBe("winning");
    expect(openSide("DOWN", 100, 101)).toBe("losing");
    expect(openSide("UP", 100, 100)).toBe("flat");
    expect(openSide("UP", 100, null)).toBeNull();
  });
});

describe("dock expiry + stake helpers", () => {
  it("offers 30s, 1m, 5m, 15m chips", () => {
    expect(EXPIRY_CHIPS.map((c) => c.sec)).toEqual([30, 60, 300, 900]);
    expect(isChipExpiry(300)).toBe(true);
    expect(isChipExpiry(120)).toBe(false);
    expect(formatDuration(120)).toBe("2m");
  });
  it("computes the stake profit", () => {
    expect(stakeToMinor("100")).toBe(10_000);
    expect(profitForStake(10_000, 93)).toBe(9_300);
    expect(profitForStake(0, 93)).toBeNull();
  });
});
