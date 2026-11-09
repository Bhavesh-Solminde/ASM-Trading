import { beforeEach, expect, it } from "vitest";
import { clearAcceptedProtection, useProtection } from "./protection-store";
import { EMPTY_PROTECTION } from "./otc-protection";
const trade = { accountId: "a", symbol: "BTCUSDT", direction: "UP", stopLoss: 90, takeProfit: 110 };
const draft = { enabled: true, direction: "UP" as const, stopLoss: 90, takeProfit: 110 };
beforeEach(() => useProtection.getState().set("a:BTCUSDT", draft));
it("removes submitted handles after acceptance", () => {
  clearAcceptedProtection(trade);
  expect(useProtection.getState().draft).toEqual(EMPTY_PROTECTION);
});
it("preserves a new draft or another account's draft", () => {
  useProtection.getState().set("a:BTCUSDT", { ...draft, stopLoss: 95 });
  clearAcceptedProtection(trade);
  expect(useProtection.getState().draft.stopLoss).toBe(95);
  useProtection.getState().set("b:BTCUSDT", draft);
  clearAcceptedProtection(trade);
  expect(useProtection.getState().draft.enabled).toBe(true);
});
