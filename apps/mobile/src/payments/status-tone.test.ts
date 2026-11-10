import { describe, expect, it } from "vitest";
import { statusTagTone, tagInkKey } from "./status-tone";

describe("statusTagTone", () => {
  it("is green for money that arrived or a trade that won", () => {
    for (const s of ["COMPLETED", "PAID", "WON"]) expect(statusTagTone(s), s).toBe("up");
  });
  it("is the caution tone for a payment still moving", () => {
    for (const s of ["AWAITING_PAYMENT", "PENDING_CONFIRMATION", "REQUESTED", "HELD", "APPROVED"]) expect(statusTagTone(s), s).toBe("caution");
  });
  it("is the down tone for a payment that ended badly", () => {
    for (const s of ["REJECTED", "EXPIRED", "CANCELLED_BY_USER", "LOST"]) expect(statusTagTone(s), s).toBe("down");
  });
  it("is neutral for anything else, including values the app has never seen", () => {
    for (const s of ["OPEN", "REFUNDED", "SOMETHING_NEW", ""]) expect(statusTagTone(s), s).toBe("neutral");
  });
});

describe("tagInkKey", () => {
  it("maps each tone to its readable text colour token, never gold", () => {
    expect(tagInkKey("up")).toBe("up");
    expect(tagInkKey("caution")).toBe("accentText");
    expect(tagInkKey("down")).toBe("downText");
    expect(tagInkKey("neutral")).toBe("ink2");
    for (const tone of ["up", "caution", "down", "neutral"] as const) expect(tagInkKey(tone)).not.toBe("gold");
  });
});
