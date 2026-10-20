import { describe, expect, it } from "vitest";
import { ProfileViewSchema } from "./account";

const profile = {
  email: "a@b.co",
  emailVerified: true,
  nickname: null,
  firstName: "Asha",
  lastName: null,
  dateOfBirth: "1990-01-31",
  aadhaar: null,
  pan: null,
  address: null,
  country: "India",
  kycStatus: "NOT_STARTED",
  kycReviewNote: null,
  kycDocuments: ["AADHAAR_FRONT", "SELFIE"],
  twoFaForLogin: false,
  twoFaForWithdrawal: false,
  locale: "en",
};

describe("ProfileViewSchema", () => {
  it("accepts what GET /api/account returns", () => {
    expect(ProfileViewSchema.parse(profile)).toEqual(profile);
  });

  it("accepts all four KYC states and rejects an unknown one", () => {
    for (const kycStatus of ["NOT_STARTED", "PENDING", "VERIFIED", "REJECTED"]) {
      expect(ProfileViewSchema.safeParse({ ...profile, kycStatus }).success).toBe(true);
    }
    expect(ProfileViewSchema.safeParse({ ...profile, kycStatus: "APPROVED" }).success).toBe(false);
  });

  it("restricts documents to the four kinds", () => {
    expect(ProfileViewSchema.safeParse({ ...profile, kycDocuments: ["PAN", "AADHAAR_BACK"] }).success).toBe(true);
    expect(ProfileViewSchema.safeParse({ ...profile, kycDocuments: ["PASSPORT"] }).success).toBe(false);
  });

  it("rejects a profile missing a field", () => {
    const { email: _email, ...rest } = profile;
    expect(ProfileViewSchema.safeParse(rest).success).toBe(false);
  });
});
