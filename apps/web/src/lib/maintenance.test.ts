import { describe, expect, it } from "vitest";
import {
  MAINTENANCE_PATH,
  isAllowedDuringMaintenance,
  isApiPath,
  isMaintenanceMode,
} from "./maintenance";

describe("isMaintenanceMode", () => {
  it("is off when the variable is missing or empty", () => {
    expect(isMaintenanceMode({})).toBe(false);
    expect(isMaintenanceMode({ MAINTENANCE_MODE: "" })).toBe(false);
    expect(isMaintenanceMode({ MAINTENANCE_MODE: "   " })).toBe(false);
  });

  it("is off for anything that is not an affirmative", () => {
    // The dangerous direction is a typo reading as ON and taking the site
    // down; "0" and "false" must stay off.
    for (const value of ["0", "false", "off", "no", "maybe", "disabled"]) {
      expect(isMaintenanceMode({ MAINTENANCE_MODE: value })).toBe(false);
    }
  });

  it("accepts the spellings someone might actually put in a .env", () => {
    for (const value of ["1", "true", "TRUE", "on", "yes", " true "]) {
      expect(isMaintenanceMode({ MAINTENANCE_MODE: value })).toBe(true);
    }
  });
});

describe("isAllowedDuringMaintenance", () => {
  it("keeps the operator's own routes reachable", () => {
    // Locking the admin out of the console while the site is down is the one
    // failure this feature must not have.
    expect(isAllowedDuringMaintenance("/admin")).toBe(true);
    expect(isAllowedDuringMaintenance("/admin/kyc")).toBe(true);
    expect(isAllowedDuringMaintenance("/api/auth/logout")).toBe(true);
    expect(isAllowedDuringMaintenance("/api/health")).toBe(true);
  });

  it("allows the maintenance page itself so the rewrite cannot loop", () => {
    expect(isAllowedDuringMaintenance(MAINTENANCE_PATH)).toBe(true);
  });

  it("allows the static assets the maintenance page renders with", () => {
    expect(isAllowedDuringMaintenance("/_next/static/css/app.css")).toBe(true);
    expect(isAllowedDuringMaintenance("/favicon.ico")).toBe(true);
  });

  it("blocks everything a trader would reach for", () => {
    for (const path of [
      "/",
      "/trade",
      "/account",
      "/account/verify",
      "/login",
      "/register",
      "/deposit",
      "/withdraw",
      "/api/trades",
      "/api/account/kyc/submit",
    ]) {
      expect(isAllowedDuringMaintenance(path)).toBe(false);
    }
  });

  it("does not let a lookalike prefix through", () => {
    // A raw startsWith would let every one of these inherit an allowance it
    // was never granted. Matching is on whole segments instead.
    for (const path of [
      "/administrator",
      "/admin-backup",
      "/api/authorise",
      "/api/healthcheck-public",
      "/_nextdoor",
      "/maintenance-window",
    ]) {
      expect(isAllowedDuringMaintenance(path)).toBe(false);
    }
  });
});

describe("isApiPath", () => {
  it("separates API callers from page requests", () => {
    expect(isApiPath("/api/trades")).toBe(true);
    expect(isApiPath("/trade")).toBe(false);
    expect(isApiPath("/")).toBe(false);
  });
});
