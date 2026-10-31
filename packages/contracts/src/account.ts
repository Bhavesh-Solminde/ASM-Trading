import { z } from "zod";
import { KycStatusSchema } from "./app";

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
  pan: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, "PAN looks like ABCDE1234F")
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

export const KYC_DOCUMENT_KIND_VALUES = ["AADHAAR_FRONT", "AADHAAR_BACK", "PAN", "SELFIE"] as const;
export type KycDocumentKindValue = (typeof KYC_DOCUMENT_KIND_VALUES)[number];

/**
 * The profile fields a KYC submission needs, in the order the form asks for them. @asm/db keeps its own copy
 * (`IDENTITY_FIELDS`, which the server checks on submit); a test in @asm/db fails if the two drift apart.
 */
export const KYC_IDENTITY_FIELDS = ["firstName", "lastName", "dateOfBirth", "aadhaar", "pan", "address", "country"] as const;
export type KycIdentityField = (typeof KYC_IDENTITY_FIELDS)[number];

/**
 * The profile `GET /api/account` returns (inside `{ profile }`): `ProfileView` in
 * packages/db/src/repositories/profile.ts. Never carries the KYC files themselves.
 */
export const ProfileViewSchema = z.object({
  email: z.string(),
  emailVerified: z.boolean(),
  nickname: z.string().nullable(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  /** "YYYY-MM-DD". */
  dateOfBirth: z.string().nullable(),
  aadhaar: z.string().nullable(),
  pan: z.string().nullable(),
  address: z.string().nullable(),
  country: z.string().nullable(),
  kycStatus: KycStatusSchema,
  /** Why an admin rejected the last submission (null unless REJECTED). */
  kycReviewNote: z.string().nullable(),
  kycDocuments: z.array(z.enum(KYC_DOCUMENT_KIND_VALUES)),
  twoFaForLogin: z.boolean(),
  twoFaForWithdrawal: z.boolean(),
  /** UI + push language ("en" | "hi"). */
  locale: z.string(),
});
export type ProfileViewDto = z.infer<typeof ProfileViewSchema>;
