import { z } from "zod";

/**
 * Strict, and deliberately omits role, kycStatus and cumulativeDeposits. Those
 * are server-owned; a request carrying one is rejected, which is the
 * mass-assignment control expressed at the boundary.
 */
export const UpdateProfileSchema = z.strictObject({
  nickname: z.string().trim().max(40).optional(),
  firstName: z.string().trim().max(60).optional(),
  lastName: z.string().trim().max(60).optional(),
  dateOfBirth: z.string().date().optional(),
  aadhaar: z
    .string()
    .trim()
    .regex(/^[0-9]{12}$/, "Aadhaar is 12 digits")
    .optional(),
  address: z.string().trim().max(240).optional(),
  country: z.string().trim().max(60).optional(),
});
export type UpdateProfileInput = z.infer<typeof UpdateProfileSchema>;

export const TwoFaToggleSchema = z.strictObject({
  forLogin: z.boolean(),
  forWithdrawal: z.boolean(),
});
export type TwoFaToggleInput = z.infer<typeof TwoFaToggleSchema>;

export const TwoFaVerifySchema = z.strictObject({
  code: z.string().trim().regex(/^[0-9]{6}$/, "Enter the six-digit code"),
});
export type TwoFaVerifyInput = z.infer<typeof TwoFaVerifySchema>;
