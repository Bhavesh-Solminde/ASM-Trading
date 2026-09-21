import { describe, expect, it } from "vitest";
import { RAIL_ITEMS, availableRailItems, isRailItemActive } from "./nav";

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
