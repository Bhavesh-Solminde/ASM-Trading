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
export const RegisterSchema = z.strictObject({ email, password });
export const LoginSchema = z.strictObject({ email, password });

export type RegisterInput = z.infer<typeof RegisterSchema>;
export type LoginInput = z.infer<typeof LoginSchema>;
