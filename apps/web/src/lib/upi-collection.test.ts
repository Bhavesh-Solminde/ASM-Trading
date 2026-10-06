import { afterEach, describe, expect, it, vi } from "vitest";
import { DEMO_VPA } from "@asm/db";
import { pickCollectionVpa, upiCollection, upiDepositsEnabled } from "./upi-collection";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("upiCollection", () => {
  it("falls back to the demo VPA and ASM Trade when nothing is configured", () => {
    vi.stubEnv("UPI_COLLECTION_VPAS", "");
    vi.stubEnv("UPI_PAYEE_NAME", "");
    vi.stubEnv("UPI_MERCHANT_CODE", "");
    expect(upiCollection()).toEqual({ vpas: [DEMO_VPA], payeeName: "ASM Trade", merchantCode: null });
  });

  it("splits a comma-separated VPA list, trimming blanks and empty entries", () => {
    vi.stubEnv("UPI_COLLECTION_VPAS", " Q1@ybl, Q2@ybl ,,Q3@ybl ");
    vi.stubEnv("UPI_PAYEE_NAME", " Indian Trade ");
    expect(upiCollection().vpas).toEqual(["Q1@ybl", "Q2@ybl", "Q3@ybl"]);
    expect(upiCollection().payeeName).toBe("Indian Trade");
  });
});

describe("pickCollectionVpa", () => {
  it("only ever returns a configured VPA, and reaches every one of them", () => {
    vi.stubEnv("UPI_COLLECTION_VPAS", "Q1@ybl,Q2@ybl,Q3@ybl,Q4@ybl");
    const seen = new Set<string>();
    for (let i = 0; i < 400; i++) seen.add(pickCollectionVpa());
    // 400 uniform draws over 4 options miss one with probability ~4·(3/4)^400 ≈ 0.
    expect([...seen].sort()).toEqual(["Q1@ybl", "Q2@ybl", "Q3@ybl", "Q4@ybl"]);
  });
});

describe("upiDepositsEnabled", () => {
  it("is on only for the exact value 'on'", () => {
    vi.stubEnv("UPI_DEPOSITS_ENABLED", "on");
    expect(upiDepositsEnabled()).toBe(true);
    for (const value of ["", "off", "true", "ON"]) {
      vi.stubEnv("UPI_DEPOSITS_ENABLED", value);
      expect(upiDepositsEnabled()).toBe(false);
    }
  });
});
