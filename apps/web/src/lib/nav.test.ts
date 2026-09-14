import { describe, expect, it } from "vitest";
import { RAIL_ITEMS, availableRailItems } from "./nav";

describe("rail registry", () => {
  it("lists every destination from the screenshots", () => {
    const ids = RAIL_ITEMS.map((i) => i.id);
    for (const expected of ["trade", "support", "account", "tournaments", "market", "more"]) {
      expect(ids).toContain(expected);
    }
  });

  it("marks the four deferred destinations unavailable", () => {
    for (const id of ["tournaments", "market", "analytics", "more"]) {
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

  it("uses only relative hrefs — no external destinations in the rail", () => {
    for (const item of RAIL_ITEMS) {
      expect(item.href.startsWith("/")).toBe(true);
    }
  });
});
