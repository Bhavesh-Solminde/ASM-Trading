import { describe, expect, it } from "vitest";
import { durationForTargetTime, offeredExpirySlots } from "./expiry-times";

const DS = [5, 10, 30, 60, 300] as const;

describe("offeredExpirySlots", () => {
  it("maps each duration to now + duration, ascending", () => {
    const now = 1_000_000;
    const slots = offeredExpirySlots(now, DS);
    expect(slots).toHaveLength(DS.length);
    expect(slots[0]).toEqual({ durationSec: 5, epochMs: now + 5_000 });
    expect(slots[4]).toEqual({ durationSec: 300, epochMs: now + 300_000 });
    for (let i = 1; i < slots.length; i++) {
      expect(slots[i]!.epochMs).toBeGreaterThan(slots[i - 1]!.epochMs);
    }
  });
});

describe("durationForTargetTime", () => {
  const now = 1_000_000;

  it("snaps to the nearest offered duration", () => {
    expect(durationForTargetTime(now, now + 62_000, DS)).toBe(60);
    expect(durationForTargetTime(now, now + 40_000, DS)).toBe(30);
  });

  it("clamps a far-future time to the longest duration", () => {
    expect(durationForTargetTime(now, now + 10_000_000, DS)).toBe(300);
  });

  it("clamps a past or too-near time to the shortest duration", () => {
    expect(durationForTargetTime(now, now - 5_000, DS)).toBe(5);
    expect(durationForTargetTime(now, now + 1_000, DS)).toBe(5);
  });

  it("always returns a member of the offered durations", () => {
    for (let ms = -10_000; ms < 400_000; ms += 3_333) {
      expect(DS).toContain(durationForTargetTime(now, now + ms, DS));
    }
  });
});
