import { describe, expect, it } from "vitest";
import { isLeaderboardCountry, normalizeCountry } from "./country";

describe("normalizeCountry", () => {
  it("upper-cases an ISO code", () => {
    expect(normalizeCountry("in")).toBe("IN");
    expect(normalizeCountry(" AE ")).toBe("AE");
  });

  it("maps typed country names, ignoring case, dots and spacing", () => {
    expect(normalizeCountry("India")).toBe("IN");
    expect(normalizeCountry("United  Arab Emirates")).toBe("AE");
    expect(normalizeCountry("U.A.E.")).toBe("AE");
    expect(normalizeCountry("sri lanka")).toBe("LK");
  });

  it("returns null for empty or unrecognised input", () => {
    expect(normalizeCountry(null)).toBeNull();
    expect(normalizeCountry("   ")).toBeNull();
    expect(normalizeCountry("Atlantis")).toBeNull();
  });
});

describe("isLeaderboardCountry", () => {
  it("accepts South Asia and the Gulf", () => {
    for (const c of ["IN", "PK", "BD", "NP", "LK", "AE", "SA", "QA", "KW", "OM", "BH", "India"]) {
      expect(isLeaderboardCountry(c)).toBe(true);
    }
  });

  it("rejects everyone else and unknowns", () => {
    for (const c of ["PH", "MY", "EG", "NG", "ID", "US", "Philippines", null, "Atlantis"]) {
      expect(isLeaderboardCountry(c)).toBe(false);
    }
  });
});
