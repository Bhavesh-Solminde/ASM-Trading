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

  it("keeps the four known document kinds", () => {
    expect(ProfileViewSchema.parse({ ...profile, kycDocuments: ["PAN", "AADHAAR_BACK"] }).kycDocuments).toEqual(["PAN", "AADHAAR_BACK"]);
  });

  it("ignores a document kind it does not know instead of failing, so an older build still opens the profile when the server adds one", () => {
    const parsed = ProfileViewSchema.safeParse({ ...profile, kycDocuments: ["PAN", "PASSPORT", "SELFIE"] });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.kycDocuments).toEqual(["PAN", "SELFIE"]);
    expect(ProfileViewSchema.parse({ ...profile, kycDocuments: ["PASSPORT"] }).kycDocuments).toEqual([]);
  });

  it("rejects a profile missing a field", () => {
    const rest = Object.fromEntries(Object.entries(profile).filter(([key]) => key !== "email"));
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
