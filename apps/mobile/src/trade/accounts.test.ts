import { describe, expect, it } from "vitest";
import { accountOfType, canUseLive, resolveAccount, type AppAccount } from "./accounts";

const demo: AppAccount = { id: "d", type: "DEMO", currency: "USD", realBalance: 0, bonusBalance: 0 };
const live: AppAccount = { id: "l", type: "LIVE", currency: "USD", realBalance: 0, bonusBalance: 0 };

describe("account selection", () => {
  it("restores the saved account", () => {
    expect(resolveAccount([demo, live], "l", true)?.id).toBe("l");
    expect(resolveAccount([demo, live], "d", true)?.id).toBe("d");
  });
  it("falls back to demo when nothing is saved or the saved account is gone", () => {
    expect(resolveAccount([live, demo], null, true)?.id).toBe("d");
    expect(resolveAccount([demo, live], "gone", true)?.id).toBe("d");
  });
  it("never lands on the live account without live access", () => {
    expect(resolveAccount([demo, live], "l", false)?.id).toBe("d");
  });
  it("uses whatever exists when there is no demo account", () => {
    expect(resolveAccount([live], null, true)?.id).toBe("l");
    expect(resolveAccount([], null, true)).toBeUndefined();
  });
  it("allows live only with access and a live account", () => {
    expect(canUseLive([demo, live], true)).toBe(true);
    expect(canUseLive([demo, live], false)).toBe(false);
    expect(canUseLive([demo], true)).toBe(false);
  });
  it("finds an account by type", () => {
    expect(accountOfType([demo, live], "LIVE")?.id).toBe("l");
    expect(accountOfType([demo], "LIVE")).toBeUndefined();
  });
});
