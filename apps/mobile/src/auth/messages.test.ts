import { describe, expect, it } from "vitest";
import { LoginSchema, RegisterSchema } from "@asm/contracts";
import { ApiError, GENERIC_ERROR } from "@/api/errors";
import { errorText, validationKey } from "./messages";

const t = (key: string) => `<${key}>`;

describe("errorText", () => {
  it("shows a server message as-is", () => {
    expect(errorText(new ApiError("Email or password is incorrect.", 401, null), t)).toBe("Email or password is incorrect.");
  });
  it("translates the generic fallback message", () => {
    expect(errorText(new ApiError(GENERIC_ERROR, 500, null), t)).toBe("<common.genericError>");
  });
  it("translates an offline failure", () => {
    expect(errorText(new ApiError("No connection.", 0, "offline"), t)).toBe("<common.noConnection>");
  });
  it("never shows a raw gate code", () => {
    expect(errorText(new ApiError("maintenance", 503, "maintenance"), t)).toBe("<common.genericError>");
  });
  it("uses the given fallback key for non-API errors", () => {
    expect(errorText(new Error("native boom"), t, "auth.googleFailed")).toBe("<auth.googleFailed>");
    expect(errorText("x", t)).toBe("<common.genericError>");
  });
});

describe("validationKey", () => {
  it("maps register field failures to translated keys", () => {
    const r = RegisterSchema.safeParse({ name: "A", email: "a@b.co", password: "x".repeat(12) });
    expect(r.success ? null : validationKey(r.error.issues)).toBe("auth.errName");
  });
  it("maps email and password failures", () => {
    const e = LoginSchema.safeParse({ email: "nope", password: "x".repeat(12) });
    expect(e.success ? null : validationKey(e.error.issues)).toBe("auth.errEmail");
    const p = LoginSchema.safeParse({ email: "a@b.co", password: "short" });
    expect(p.success ? null : validationKey(p.error.issues)).toBe("auth.errPassword");
  });
  it("falls back to the generic check-your-details key", () => {
    expect(validationKey([])).toBe("auth.checkDetails");
  });
});
