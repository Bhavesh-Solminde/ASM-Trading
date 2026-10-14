import { describe, expect, it } from "vitest";
import { countdownText } from "./countdown-text";

describe("countdownText", () => {
  it("shows the countdown while time is left", () => {
    expect(countdownText({ expired: false, remainingSec: 75 }, "Settling…")).toBe("1:15");
  });

  it("says Settling instead of a frozen 0:00 once the expiry has passed and no result has arrived", () => {
    expect(countdownText({ expired: true, remainingSec: 0 }, "Settling…")).toBe("Settling…");
  });

  it("does not say Settling in the last second before the expiry", () => {
    expect(countdownText({ expired: false, remainingSec: 0.4 }, "Settling…")).toBe("0:01");
  });
});
