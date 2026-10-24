import { describe, expect, it } from "vitest";
import {
  USER_STATUS_REASONS,
  formatStatusReason,
  reasonLabel,
} from "./user-status";

describe("formatStatusReason", () => {
  it("renders the label when no note is supplied", () => {
    expect(formatStatusReason("bonus_abuse", "")).toBe("Bonus abuse");
    expect(formatStatusReason("bonus_abuse", null)).toBe("Bonus abuse");
    expect(formatStatusReason("bonus_abuse", "   ")).toBe("Bonus abuse");
  });

  it("appends a trimmed note after an em-dash", () => {
    expect(formatStatusReason("chargeback", "  ticket 42  ")).toBe(
      "Chargeback / payment dispute — ticket 42",
    );
  });

  it("falls back to the code when the label is unknown", () => {
    expect(reasonLabel("unknown_code")).toBe("unknown_code");
  });

  it("exports a non-empty set of reason codes", () => {
    expect(USER_STATUS_REASONS.length).toBeGreaterThan(0);
    expect(USER_STATUS_REASONS.every((r) => r.code && r.label)).toBe(true);
  });
});
