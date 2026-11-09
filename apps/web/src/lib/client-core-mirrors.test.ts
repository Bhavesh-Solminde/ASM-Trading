import { describe, expect, it } from "vitest";
import {
  BONUS_TIERS as SERVER_TIERS,
  MAX_DEPOSIT_INR_MINOR,
  MAX_DEPOSIT_USDT_MINOR,
  MIN_DEPOSIT_INR_MINOR,
  MIN_DEPOSIT_USDT_MINOR,
} from "@asm/db";
import { BONUS_TIERS, INR_MAX, INR_MIN, USDT_MAX_USD, USDT_MIN_USD } from "@asm/client-core";

// @asm/client-core can't depend on @asm/db (server-only), so the checks that the
// client-side copies still match the server's constants live here in the web app.
describe("bonus tiers mirror", () => {
  it("matches the tiers the server grants", () => {
    expect([...BONUS_TIERS]).toEqual([...SERVER_TIERS]);
  });
});

describe("deposit limits mirror", () => {
  it("matches the bounds the server enforces", () => {
    expect(INR_MIN * 100).toBe(MIN_DEPOSIT_INR_MINOR);
    expect(INR_MAX * 100).toBe(MAX_DEPOSIT_INR_MINOR);
    expect(USDT_MIN_USD * 100).toBe(MIN_DEPOSIT_USDT_MINOR);
    expect(USDT_MAX_USD * 100).toBe(MAX_DEPOSIT_USDT_MINOR);
  });
});
