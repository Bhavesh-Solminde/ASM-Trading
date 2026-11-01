import { describe, expect, it } from "vitest";
import { shouldAskPermission } from "./permission-moment";

describe("shouldAskPermission", () => {
  it("asks once, after the first live trade settles or the first deposit is created", () => {
    expect(shouldAskPermission({ asked: false, status: "undetermined", event: "live_trade_settled" })).toBe(true);
    expect(shouldAskPermission({ asked: false, status: "undetermined", event: "deposit_created" })).toBe(true);
  });
  it("never asks at other moments, twice, or after a decision", () => {
    expect(shouldAskPermission({ asked: false, status: "undetermined", event: "other" })).toBe(false);
    expect(shouldAskPermission({ asked: true, status: "undetermined", event: "deposit_created" })).toBe(false);
    expect(shouldAskPermission({ asked: false, status: "denied", event: "deposit_created" })).toBe(false);
    expect(shouldAskPermission({ asked: false, status: "granted", event: "deposit_created" })).toBe(false);
  });
});
