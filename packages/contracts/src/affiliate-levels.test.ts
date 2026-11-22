import { describe, expect, it } from "vitest";
import { AFFILIATE_LEVELS, levelForDeposits } from "./affiliate-levels";

describe("affiliate level bands", () => {
  it.each([[0, 1], [14, 1], [15, 2], [49, 2], [50, 3], [99, 3], [100, 4], [199, 4], [200, 5], [399, 5], [400, 6], [699, 6], [700, 7]])(
    "%i qualifying first deposits means level %i",
    (count, level) => expect(levelForDeposits(count)).toBe(AFFILIATE_LEVELS[level - 1]),
  );
});
