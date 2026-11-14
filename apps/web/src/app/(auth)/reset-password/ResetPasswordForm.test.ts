import { describe, expect, it } from "vitest";
import { safeLoginPath } from "./ResetPasswordForm";

describe("reset-password return path", () => {
  it("returns affiliates to the affiliate login", () => {
    expect(safeLoginPath("/affiliate/login")).toBe("/affiliate/login");
    expect(safeLoginPath("/affiliate/login?reset=1")).toBe("/affiliate/login");
  });

  it("falls back to the regular login for anything else", () => {
    for (const value of [undefined, null, "/login", "https://evil.example/affiliate/login", "//evil.example", 42]) {
      expect(safeLoginPath(value)).toBe("/login");
    }
  });
});
