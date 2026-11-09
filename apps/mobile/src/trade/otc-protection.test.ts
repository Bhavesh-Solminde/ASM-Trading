import { expect, it } from "vitest";
import { EMPTY_PROTECTION, initialProtection, protectionValid } from "./otc-protection";
it.each(["UP", "DOWN"] as const)("creates rounded %s levels and rejects crossed/wrong-direction levels", direction => {
  const draft = initialProtection(.687064, 6, direction);
  expect(protectionValid(draft, direction, .687064)).toBe(true);
  expect(protectionValid(draft, direction === "UP" ? "DOWN" : "UP", .687064)).toBe(false);
  expect(protectionValid(draft, direction, draft.stopLoss!)).toBe(false);
  expect(protectionValid({ ...draft, takeProfit: Infinity }, direction, .687064)).toBe(false);
});
it("disabled protection places no restriction", () => expect(protectionValid(EMPTY_PROTECTION, "DOWN", 100)).toBe(true));
