import { describe, expect, it } from "vitest";
import { LoginSchema, RegisterSchema } from "./auth";

describe("RegisterSchema", () => {
  const valid = { name: "Asha Rao", email: "a@b.com", password: "correct-horse-battery" };

  it("accepts a valid registration", () => {
    expect(RegisterSchema.parse(valid)).toEqual(valid);
  });

  it("rejects an injected role field rather than stripping it", () => {
    const result = RegisterSchema.safeParse({ ...valid, role: "ADMIN" });
    expect(result.success).toBe(false);
  });

  it("rejects an injected balance field", () => {
    const result = RegisterSchema.safeParse({ ...valid, realBalance: 999999 });
    expect(result.success).toBe(false);
  });

  it("rejects a password under 12 characters", () => {
    expect(RegisterSchema.safeParse({ ...valid, password: "short" }).success).toBe(
      false,
    );
  });

  it("rejects a malformed email", () => {
    expect(RegisterSchema.safeParse({ ...valid, email: "nope" }).success).toBe(
      false,
    );
  });

  it("requires a name of at least two characters, trimmed", () => {
    expect(RegisterSchema.safeParse({ email: valid.email, password: valid.password }).success).toBe(false);
    expect(RegisterSchema.safeParse({ ...valid, name: "  A " }).success).toBe(false);
    expect(RegisterSchema.parse({ ...valid, name: "  Asha Rao  " }).name).toBe("Asha Rao");
  });

  it("lowercases and trims the email", () => {
    const parsed = RegisterSchema.parse({ ...valid, email: "  A@B.COM  " });
    expect(parsed.email).toBe("a@b.com");
  });
});

describe("LoginSchema", () => {
  it("rejects unknown keys", () => {
    const result = LoginSchema.safeParse({
      email: "a@b.com",
      password: "correct-horse-battery",
      impersonate: "someone-else",
    });
    expect(result.success).toBe(false);
  });
});
