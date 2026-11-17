import { z } from "zod";

const email = z
  .string()
  .trim()
  .toLowerCase()
  .email("Enter a valid email address");

const password = z
  .string()
  .min(12, "Use at least 12 characters")
  .max(200, "Password is too long");

/**
 * Strict: a body containing `role`, `realBalance`, or any other unexpected key
 * is rejected outright. Stripping would silently accept a privilege-escalation
 * attempt; rejecting makes it visible and loggable.
 */
const name = z
  .string()
  .trim()
  .min(2, "Enter your full name")
  .max(80, "Name is too long");

/** Which sign-in portal the request came from. Omitted = the regular site. */
const portal = z.enum(["user", "affiliate"]).default("user");

/** Typed invitation code; shape is checked server-side against real codes. */
const referralCode = z.string().trim().max(32).optional();

export const RegisterSchema = z.strictObject({ name, email, password, portal, referralCode });
export const LoginSchema = z.strictObject({ email, password, portal });
export const PasswordResetRequestSchema = z.strictObject({ email, portal });
// A base64url 32-byte token is 43 characters; the bounds only reject junk.
export const PasswordResetConfirmSchema = z.strictObject({
  token: z.string().min(32).max(128),
  password,
});

export type RegisterInput = z.infer<typeof RegisterSchema>;
export type LoginInput = z.infer<typeof LoginSchema>;
export type AuthPortal = z.infer<typeof portal>;
