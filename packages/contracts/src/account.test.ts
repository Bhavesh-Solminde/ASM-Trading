import { describe, expect, it } from "vitest";
import { KYC_IDENTITY_FIELDS, ProfileViewSchema, UpdateProfileSchema } from "./account";

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

describe("KYC_IDENTITY_FIELDS", () => {
  it("lists the seven identity fields a submission needs, in the order the form asks", () => {
    expect(KYC_IDENTITY_FIELDS).toEqual(["firstName", "lastName", "dateOfBirth", "aadhaar", "pan", "address", "country"]);
  });
  it("only names fields a profile update accepts and a profile view returns", () => {
    const updatable = Object.keys(UpdateProfileSchema.shape);
    const viewed = Object.keys(ProfileViewSchema.shape);
    for (const field of KYC_IDENTITY_FIELDS) {
      expect(updatable).toContain(field);
      expect(viewed).toContain(field);
    }
  });
});
