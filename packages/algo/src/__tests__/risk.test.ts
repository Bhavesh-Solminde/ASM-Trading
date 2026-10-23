import { describe, it, expect } from "vitest";
import {
  dynamicMaxStake,
  exposureCap,
  dailyWinCap,
  isDailyCircuitBroken,
  emergencyModeConfig,
  isVolCircuitBroken,
  demoFillAdjustment,
} from "../risk";

describe("dynamicMaxStake", () => {
  it("returns 0.5% of treasury", () => {
    // ₹5L = 500_000_00 paisa → 0.5% = 250_000
    expect(dynamicMaxStake(500_000_00)).toBe(250_000);
  });

  it("caps at ₹1,00,000 (100_000_00 paisa)", () => {
    expect(dynamicMaxStake(100_000_000_00)).toBe(100_000_00);
  });

  it("returns small value for small treasury", () => {
    // ₹1L = 100_000_00 paisa → 0.5% = 50_000 paisa = ₹500
    expect(dynamicMaxStake(100_000_00)).toBe(50_000);
  });
});

describe("exposureCap", () => {
  it("returns ₹5L for <20 users", () => {
    expect(exposureCap(10)).toBe(500_000_00);
  });

  it("returns ₹20L for 20-99 users", () => {
    expect(exposureCap(50)).toBe(2_000_000_00);
  });

  it("returns ₹50L for ≥100 users", () => {
    expect(exposureCap(200)).toBe(5_000_000_00);
  });
});

describe("dailyWinCap", () => {
  it("returns 0.2% of treasury", () => {
    expect(dailyWinCap(500_000_00)).toBe(100_000);
  });

  it("caps at ₹10,000 (1_000_000 paisa)", () => {
    expect(dailyWinCap(10_000_000_000_00)).toBe(1_000_000);
  });
});

describe("isDailyCircuitBroken", () => {
  it("false when daily loss < 2% treasury", () => {
    expect(isDailyCircuitBroken(-5000, 500_000_00)).toBe(false);
  });

  it("true when daily loss ≥ 2% treasury", () => {
    // 2% of 500_000_00 = 10_000_00
    expect(isDailyCircuitBroken(-10_000_00, 500_000_00)).toBe(true);
  });

  it("false when house is profitable", () => {
    expect(isDailyCircuitBroken(50000, 500_000_00)).toBe(false);
  });
});

describe("emergencyModeConfig", () => {
  it("returns 5× magnet, 3× spread, 0.5× stake", () => {
    const config = emergencyModeConfig();
    expect(config.magnetMult).toBe(5);
    expect(config.spreadMult).toBe(3);
    expect(config.stakeMult).toBe(0.5);
  });
});

describe("isVolCircuitBroken", () => {
  it("false for normal moves", () => {
    const moves = [0.001, -0.0005, 0.0008, -0.001];
    expect(isVolCircuitBroken(moves, 0.005)).toBe(false);
  });

  it("true for >3σ cumulative move", () => {
    // 3 × 0.005 = 0.015 threshold
    const moves = [0.008, 0.005, 0.004]; // sum = 0.017 > 0.015
    expect(isVolCircuitBroken(moves, 0.005)).toBe(true);
  });

  it("false for empty moves", () => {
    expect(isVolCircuitBroken([], 0.005)).toBe(false);
  });

  it("false for zero sigma", () => {
    expect(isVolCircuitBroken([0.1], 0)).toBe(false);
  });
});

describe("demoFillAdjustment", () => {
  it("gives demo users mid-price fill (saves half spread)", () => {
    const fill = demoFillAdjustment("UP", 94976, 95024);
    expect(fill).toBe(95000); // midpoint
  });

  it("same for SHORT direction", () => {
    const fill = demoFillAdjustment("DOWN", 94976, 95024);
    expect(fill).toBe(95000);
  });
});
