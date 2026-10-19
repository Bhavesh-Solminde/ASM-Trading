import { describe, expect, it } from "vitest";
import { ledgerCellStyle } from "./ledger-cell";

describe("ledgerCellStyle", () => {
  it("takes a fixed width, or a flex share that may shrink to nothing", () => {
    expect(ledgerCellStyle({ width: 54 })).toMatchObject({ width: 54 });
    expect(ledgerCellStyle({})).toMatchObject({ flex: 1, minWidth: 0 });
    expect(ledgerCellStyle({ flex: 2 })).toMatchObject({ flex: 2 });
  });
  it("right-aligns on request", () => {
    expect(ledgerCellStyle({ width: 104, align: "right" })).toMatchObject({ alignItems: "flex-end" });
    expect(ledgerCellStyle({ width: 54 })).toMatchObject({ alignItems: "flex-start" });
  });
  it("centres vertically by default and pins to the top row edge with valign top", () => {
    expect(ledgerCellStyle({ width: 54 }).alignSelf).toBeUndefined();
    expect(ledgerCellStyle({ width: 54, valign: "top" })).toMatchObject({ alignSelf: "flex-start" });
  });
});
