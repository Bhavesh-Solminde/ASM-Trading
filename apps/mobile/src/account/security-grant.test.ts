import { beforeEach, describe, expect, it } from "vitest";
import { GRANT_TTL_MS } from "./security-flow";
import { clearSecurityGrant, grantSecurityChange, securityGrantFresh } from "./security-grant";

beforeEach(() => clearSecurityGrant());

describe("security grant", () => {
  it("is empty until a verify passes", () => {
    expect(securityGrantFresh(1_000)).toBe(false);
  });
  it("is fresh after a verify and runs out", () => {
    grantSecurityChange(1_000);
    expect(securityGrantFresh(1_000 + GRANT_TTL_MS)).toBe(true);
    expect(securityGrantFresh(1_001 + GRANT_TTL_MS)).toBe(false);
  });
  it("is spent by clearing it (a saved PIN, or leaving the screen)", () => {
    grantSecurityChange(1_000);
    clearSecurityGrant();
    expect(securityGrantFresh(1_001)).toBe(false);
  });
});
