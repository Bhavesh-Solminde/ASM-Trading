import { describe, expect, it } from "vitest";
import {
  BOTTOM_NAV_ITEMS,
  DRAWER_ITEMS,
  RAIL_ITEMS,
  availableRailItems,
  isBottomNavItemActive,
  isRailItemActive,
  navItemsFor,
} from "./nav";

describe("rail registry", () => {
  it("lists every destination from the screenshots", () => {
    const ids = RAIL_ITEMS.map((i) => i.id);
    for (const expected of ["trade", "payments", "support", "account", "tournaments", "market", "more"]) {
      expect(ids).toContain(expected);
    }
  });

  it("exposes an available leaderboard destination", () => {
    const item = RAIL_ITEMS.find((i) => i.id === "leaderboard");
    expect(item?.available).toBe(true);
    expect(item?.href).toBe("/leaderboard");
  });

  it("marks the three deferred destinations unavailable", () => {
    for (const id of ["tournaments", "market", "more"]) {
      const item = RAIL_ITEMS.find((i) => i.id === id);
      expect(item?.available).toBe(false);
    }
  });

  it("returns only available destinations from availableRailItems", () => {
    expect(availableRailItems().every((i) => i.available)).toBe(true);
  });

  it("gives every item a unique id and href", () => {
    expect(new Set(RAIL_ITEMS.map((i) => i.id)).size).toBe(RAIL_ITEMS.length);
    expect(new Set(RAIL_ITEMS.map((i) => i.href)).size).toBe(RAIL_ITEMS.length);
  });

  it("keeps trade first, matching the original", () => {
    expect(RAIL_ITEMS[0]?.id).toBe("trade");
  });

  it("lights up Payments on the deposit and withdrawal pages", () => {
    const payments = RAIL_ITEMS.find((i) => i.id === "payments")!;
    expect(isRailItemActive(payments, "/deposit")).toBe(true);
    expect(isRailItemActive(payments, "/withdrawal")).toBe(true);
    expect(isRailItemActive(payments, "/trade")).toBe(false);
  });

  it("uses only relative hrefs — no external destinations in the rail", () => {
    for (const item of RAIL_ITEMS) {
      expect(item.href.startsWith("/")).toBe(true);
    }
  });
});

describe("phone bottom bar", () => {
  const byId = (id: string) => BOTTOM_NAV_ITEMS.find((i) => i.id === id)!;

  it("is Trade, Payments, History, Account in that order", () => {
    expect(BOTTOM_NAV_ITEMS.map((i) => i.id)).toEqual(["trade", "payments", "history", "account"]);
    expect(byId("history").href).toBe("/history");
  });

  it("keeps Payments lit across deposit, withdrawal and the payments history", () => {
    const payments = byId("payments");
    for (const path of ["/deposit", "/withdrawal", "/balance"]) {
      expect(isBottomNavItemActive(payments, path)).toBe(true);
    }
    expect(isBottomNavItemActive(payments, "/history")).toBe(false);
  });

  it("lights exactly one tab on each section", () => {
    const lit = (path: string) => BOTTOM_NAV_ITEMS.filter((i) => isBottomNavItemActive(i, path)).map((i) => i.id);
    expect(lit("/trade")).toEqual(["trade"]);
    expect(lit("/history")).toEqual(["history"]);
    expect(lit("/account/verify")).toEqual(["account"]);
    expect(lit("/balance")).toEqual(["payments"]);
  });
});

describe("phone side menu", () => {
  it("adds History right after Payments and keeps Support reachable", () => {
    const ids = DRAWER_ITEMS.map((i) => i.id);
    expect(ids.indexOf("history")).toBe(ids.indexOf("payments") + 1);
    expect(ids).toContain("support");
  });

  it("leaves the desktop rail without History", () => {
    expect(RAIL_ITEMS.some((i) => i.id === "history")).toBe(false);
  });
});

describe("affiliate destination", () => {
  it("is hidden from regular accounts in the rail and the side menu", () => {
    for (const items of [RAIL_ITEMS, DRAWER_ITEMS]) {
      expect(navItemsFor(items, { affiliate: false }).some((i) => i.id === "affiliate")).toBe(false);
    }
  });

  it("is shown to affiliate accounts in place of Refer, without dropping anything else", () => {
    for (const items of [RAIL_ITEMS, DRAWER_ITEMS]) {
      const shown = navItemsFor(items, { affiliate: true });
      expect(shown).toHaveLength(items.length - 1);
      expect(shown.find((i) => i.id === "affiliate")?.href).toBe("/affiliate/dashboard");
      expect(shown.some((i) => i.id === "refer")).toBe(false);
    }
  });

  it("gives regular accounts Refer & Earn instead", () => {
    for (const items of [RAIL_ITEMS, DRAWER_ITEMS]) {
      const shown = navItemsFor(items, { affiliate: false });
      expect(shown).toHaveLength(items.length - 1);
      expect(shown.find((i) => i.id === "refer")?.href).toBe("/referral");
    }
    const refer = RAIL_ITEMS.find((i) => i.id === "refer")!;
    expect(isRailItemActive(refer, "/referral/earnings")).toBe(true);
  });

  it("is the only affiliate-only item", () => {
    expect(RAIL_ITEMS.filter((i) => i.affiliateOnly).map((i) => i.id)).toEqual(["affiliate"]);
  });

  it("lights up on the affiliate dashboard only", () => {
    const item = RAIL_ITEMS.find((i) => i.id === "affiliate")!;
    expect(isRailItemActive(item, "/affiliate/dashboard")).toBe(true);
    expect(isRailItemActive(item, "/referral")).toBe(false);
  });
});
