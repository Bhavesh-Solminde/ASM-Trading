import { describe, expect, it } from "vitest";
import { LoginSchema, PasswordResetConfirmSchema, PasswordResetRequestSchema, RegisterSchema } from "./auth";

describe("RegisterSchema", () => {
  const valid = { name: "Asha Rao", email: "a@b.com", password: "correct-horse-battery" };

  it("accepts a valid registration", () => {
    expect(RegisterSchema.parse(valid)).toEqual({ ...valid, portal: "user" });
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

  it("accepts an optional trimmed referral code up to 32 characters", () => {
    expect(RegisterSchema.parse({ ...valid, referralCode: "  abcd-2345 " }).referralCode).toBe("abcd-2345");
    expect(RegisterSchema.safeParse({ ...valid, referralCode: "A".repeat(33) }).success).toBe(false);
    expect(RegisterSchema.safeParse({ ...valid, referralCode: 12345678 }).success).toBe(false);
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

describe("password reset schemas", () => {
  it("normalises the email on a reset request", () => {
    const r = PasswordResetRequestSchema.safeParse({ email: "  Asha@Gmail.com " });
    expect(r.success && r.data.email).toBe("asha@gmail.com");
  });
  it("applies the signup password rule on confirm", () => {
    const token = "x".repeat(43);
    expect(PasswordResetConfirmSchema.safeParse({ token, password: "short" }).success).toBe(false);
    expect(PasswordResetConfirmSchema.safeParse({ token, password: "correct-horse-battery" }).success).toBe(true);
  });
  it("rejects extra keys", () => {
    expect(PasswordResetRequestSchema.safeParse({ email: "a@b.com", role: "ADMIN" }).success).toBe(false);
  });
});

describe("portal field", () => {
  const reg = { name: "Asha Rao", email: "a@b.com", password: "correct-horse-battery" };
  const login = { email: "a@b.com", password: "correct-horse-battery" };

  it("defaults to the regular site when omitted", () => {
    expect(RegisterSchema.parse(reg).portal).toBe("user");
    expect(LoginSchema.parse(login).portal).toBe("user");
    expect(PasswordResetRequestSchema.parse({ email: "a@b.com" }).portal).toBe("user");
  });

  it("accepts the affiliate portal on register, login and reset request", () => {
    expect(RegisterSchema.parse({ ...reg, portal: "affiliate" }).portal).toBe("affiliate");
    expect(LoginSchema.parse({ ...login, portal: "affiliate" }).portal).toBe("affiliate");
    expect(PasswordResetRequestSchema.parse({ email: "a@b.com", portal: "affiliate" }).portal).toBe("affiliate");
  });

  it("rejects any other portal value", () => {
    for (const portal of ["admin", "main", "", null, 1]) {
      expect(RegisterSchema.safeParse({ ...reg, portal }).success).toBe(false);
      expect(LoginSchema.safeParse({ ...login, portal }).success).toBe(false);
      expect(PasswordResetRequestSchema.safeParse({ email: "a@b.com", portal }).success).toBe(false);
    }
  });
});
