import { describe, expect, it } from "vitest";
import { countdown, hms } from "./format-time";

describe("hms", () => {
  it("formats durations as HH:MM:SS", () => {
    expect(hms(30)).toBe("00:00:30");
    expect(hms(90)).toBe("00:01:30");
    expect(hms(14400)).toBe("04:00:00");
  });

  it("clamps negative durations to zero", () => {
    expect(hms(-5)).toBe("00:00:00");
  });
});

describe("countdown", () => {
  it("rounds partial seconds up so a trade never shows 00:00 while still open", () => {
    expect(countdown(0.2)).toBe("00:01");
  });

  it("uses MM:SS under an hour and HH:MM:SS beyond", () => {
    expect(countdown(59)).toBe("00:59");
    expect(countdown(3599)).toBe("59:59");
    expect(countdown(3600)).toBe("01:00:00");
  });
});
