import { describe, expect, it } from "vitest";
import { nowForRender } from "./now-model";

describe("nowForRender", () => {
  it("keeps the stored value while paused", () => {
    expect(nowForRender({ ticking: false, wasTicking: false, stored: 5, clock: () => 99 })).toBe(5);
  });
  it("keeps the stored value while ticking steadily (the interval refreshes it)", () => {
    expect(nowForRender({ ticking: true, wasTicking: true, stored: 5, clock: () => 99 })).toBe(5);
  });
  it("reads the clock on the render where ticking resumes, not the stale stored value", () => {
    expect(nowForRender({ ticking: true, wasTicking: false, stored: 5, clock: () => 99 })).toBe(99);
  });
});
