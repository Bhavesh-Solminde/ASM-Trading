import { describe, expect, it } from "vitest";
import { pathBias, pickStyle, smoothstep } from "./path-style";

describe("smoothstep", () => {
  it("is 0 at or below 0 and 1 at or above 1", () => {
    expect(smoothstep(-1)).toBe(0);
    expect(smoothstep(0)).toBe(0);
    expect(smoothstep(1)).toBe(1);
    expect(smoothstep(2)).toBe(1);
  });

  it("is monotonically increasing on [0, 1]", () => {
    let prev = -Infinity;
    for (let i = 0; i <= 100; i++) {
      const v = smoothstep(i / 100);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it("hits 0.5 at x=0.5 (symmetric)", () => {
    expect(smoothstep(0.5)).toBeCloseTo(0.5, 6);
  });
});

describe("pathBias DIRECT", () => {
  it("is 0 at start and 1 by 2/3 through", () => {
    expect(pathBias("DIRECT", 0)).toBe(0);
    expect(pathBias("DIRECT", 2 / 3)).toBeCloseTo(1, 6);
    expect(pathBias("DIRECT", 1)).toBe(1);
  });

  it("is monotonically non-decreasing", () => {
    let prev = -Infinity;
    for (let i = 0; i <= 50; i++) {
      const v = pathBias("DIRECT", i / 50);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it("never exceeds 1 or goes below 0 for DIRECT", () => {
    for (let i = -5; i <= 105; i++) {
      const v = pathBias("DIRECT", i / 100);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

describe("pathBias OSCILLATE", () => {
  it("stays inside the 0.15 amplitude for the first 60%", () => {
    for (let i = 0; i < 60; i++) {
      const v = pathBias("OSCILLATE", i / 100);
      expect(Math.abs(v)).toBeLessThanOrEqual(0.15 + 1e-9);
    }
  });

  it("crosses zero at least three times in the first 60% (wander)", () => {
    // sin(t*8π) hits zero at t = 0, 0.125, 0.25, 0.375, 0.5 within [0, 0.6].
    // Sampled sparsely on a 0.01 grid we'll see at least 3 sign flips.
    let flips = 0;
    let prevSign = Math.sign(pathBias("OSCILLATE", 0.001));
    for (let i = 2; i < 60; i++) {
      const s = Math.sign(pathBias("OSCILLATE", i / 100));
      if (s !== 0 && s !== prevSign) {
        flips++;
        prevSign = s;
      }
    }
    expect(flips).toBeGreaterThanOrEqual(3);
  });

  it("ends at +1", () => {
    expect(pathBias("OSCILLATE", 1)).toBeCloseTo(1, 6);
  });

  it("is non-decreasing across the final 40%", () => {
    let prev = -Infinity;
    for (let i = 60; i <= 100; i++) {
      const v = pathBias("OSCILLATE", i / 100);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });
});

describe("pathBias FEINT", () => {
  it("is strictly negative through the first 35% (past 0)", () => {
    for (let i = 1; i < 35; i++) {
      const v = pathBias("FEINT", i / 100);
      expect(v).toBeLessThan(0);
    }
  });

  it("approaches -1 just before 35% elapsed", () => {
    expect(pathBias("FEINT", 0.349999)).toBeCloseTo(-1, 4);
  });

  it("crosses zero somewhere after 35%", () => {
    // smoothstep((t-0.35)/0.65) crosses 0 at t=0.35.
    // But we also want positive somewhere before the end.
    const halfway = pathBias("FEINT", 0.5);
    expect(halfway).toBeGreaterThan(0);
  });

  it("ends at +1", () => {
    expect(pathBias("FEINT", 1)).toBeCloseTo(1, 6);
  });
});

describe("pickStyle", () => {
  it("HONEST verdict always returns DIRECT", () => {
    expect(pickStyle(5, "HONEST", () => 0)).toBe("DIRECT");
    expect(pickStyle(60, "HONEST", () => 0.9)).toBe("DIRECT");
    expect(pickStyle(300, "HONEST", () => 0.5)).toBe("DIRECT");
  });

  it("5-second duration always returns DIRECT regardless of RNG", () => {
    for (let r = 0; r <= 1; r += 0.1) {
      expect(pickStyle(5, "WIN", () => r)).toBe("DIRECT");
    }
  });

  it("medium (≤ 20s): rng < 0.65 → OSCILLATE, else DIRECT", () => {
    expect(pickStyle(20, "LOSS", () => 0.0)).toBe("OSCILLATE");
    expect(pickStyle(20, "LOSS", () => 0.64)).toBe("OSCILLATE");
    expect(pickStyle(20, "LOSS", () => 0.65)).toBe("DIRECT");
    expect(pickStyle(20, "LOSS", () => 0.9)).toBe("DIRECT");
  });

  it("long (> 20s): rng < 0.35 → FEINT, < 0.8 → OSCILLATE, else DIRECT", () => {
    expect(pickStyle(60, "WIN", () => 0.0)).toBe("FEINT");
    expect(pickStyle(60, "WIN", () => 0.34)).toBe("FEINT");
    expect(pickStyle(60, "WIN", () => 0.35)).toBe("OSCILLATE");
    expect(pickStyle(60, "WIN", () => 0.79)).toBe("OSCILLATE");
    expect(pickStyle(60, "WIN", () => 0.8)).toBe("DIRECT");
    expect(pickStyle(60, "WIN", () => 0.99)).toBe("DIRECT");
  });

  it("bulk sample at 60s produces roughly the expected mix", () => {
    let state = 0xa5a5a5a5;
    const rng = () => {
      state = (state + 0x6d2b79f5) | 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const counts = { DIRECT: 0, OSCILLATE: 0, FEINT: 0 };
    const N = 5000;
    for (let i = 0; i < N; i++) counts[pickStyle(60, "WIN", rng)]++;
    // Expected ratios: 0.35 FEINT, 0.45 OSCILLATE, 0.20 DIRECT.
    expect(counts.FEINT / N).toBeGreaterThan(0.30);
    expect(counts.FEINT / N).toBeLessThan(0.40);
    expect(counts.OSCILLATE / N).toBeGreaterThan(0.40);
    expect(counts.OSCILLATE / N).toBeLessThan(0.50);
    expect(counts.DIRECT / N).toBeGreaterThan(0.15);
    expect(counts.DIRECT / N).toBeLessThan(0.25);
  });
});
