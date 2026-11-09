import { describe, expect, it } from "vitest";
import type { TradeView } from "@asm/contracts";
import { selectedOpen } from "./selected-open";
const trade = (id: string, expiryTs: number, status: TradeView["status"] = "OPEN") => ({ id, expiryTs, status }) as TradeView;
describe("open-trade selection", () => {
  it("keeps the selected trade while earlier trades are open without mutating the book", () => {
    const trades = [trade("later", 200), trade("earlier", 100), trade("closed", 50, "WON")];
    const result = selectedOpen(trades, "later");
    expect(result.open.map(t => t.id)).toEqual(["earlier", "later"]);
    expect(result.selected?.id).toBe("later");
    expect(trades[0]?.id).toBe("later");
  });
  it("falls back after settlement or account changes and clears for an empty book", () => {
    expect(selectedOpen([trade("settled", 50, "WON"), trade("next", 100)], "settled").selected?.id).toBe("next");
    expect(selectedOpen([trade("other-account", 100)], "unknown").selected?.id).toBe("other-account");
    expect(selectedOpen([], "unknown").selected).toBeNull();
  });
});
