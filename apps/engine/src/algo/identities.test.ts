import { describe, expect, it } from "vitest";
import { createRng } from "@asm/pricing";
import { LEADERBOARD_COUNTRIES } from "@asm/db";
import { BOT_COUNTRIES, botIdentity } from "./identities";

describe("botIdentity", () => {
  it("only ever claims a leaderboard-region country", () => {
    expect(BOT_COUNTRIES.every((c) => LEADERBOARD_COUNTRIES.has(c))).toBe(true);
    const rng = createRng(42);
    for (let i = 0; i < 200; i++) {
      expect(LEADERBOARD_COUNTRIES.has(botIdentity(rng, i).country)).toBe(true);
    }
  });
});
