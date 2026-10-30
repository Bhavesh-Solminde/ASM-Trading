import { describe, expect, it } from "vitest";
import { UpdateProfileSchema } from "@asm/contracts";
import { NICKNAME_MAX, identityRows, maskAadhaar, nicknameProblem, profileBody, saveEnabled } from "./profile-model";

describe("maskAadhaar", () => {
  it("shows only the last four digits, in groups", () => {
    expect(maskAadhaar("123412341234")).toBe("•••• •••• 1234");
    expect(maskAadhaar("1234 5678 9012")).toBe("•••• •••• 9012");
  });
  it("shows nothing for a missing value and masks a short one without leaking it", () => {
    expect(maskAadhaar(null)).toBeNull();
    expect(maskAadhaar("")).toBeNull();
    expect(maskAadhaar("12")).toBe("•••• •••• ••••");
  });
});

describe("nicknameProblem", () => {
  it("accepts a name and rejects an empty or over-long one", () => {
    expect(nicknameProblem("Asha")).toBeNull();
    expect(nicknameProblem("   ")).toBe("profile.err.nickname");
    expect(nicknameProblem("")).toBe("profile.err.nickname");
    expect(nicknameProblem("x".repeat(NICKNAME_MAX))).toBeNull();
    expect(nicknameProblem("x".repeat(NICKNAME_MAX + 1))).toBe("profile.err.nickname");
  });
  it("agrees with the server's own schema on length", () => {
    expect(UpdateProfileSchema.safeParse({ nickname: "x".repeat(NICKNAME_MAX) }).success).toBe(true);
    expect(UpdateProfileSchema.safeParse({ nickname: "x".repeat(NICKNAME_MAX + 1) }).success).toBe(false);
  });
});

describe("profileBody", () => {
  it("sends only the trimmed nickname, never an identity field", () => {
    const body = profileBody("  Asha ");
    expect(body).toEqual({ nickname: "Asha" });
    expect(UpdateProfileSchema.safeParse(body).success).toBe(true);
  });
});

describe("saveEnabled", () => {
  it("needs a valid nickname that differs from the saved one", () => {
    expect(saveEnabled("Asha", "Asha")).toBe(false);
    expect(saveEnabled(" Asha ", "Asha")).toBe(false);
    expect(saveEnabled("Asha R", "Asha")).toBe(true);
    expect(saveEnabled("", "Asha")).toBe(false);
    expect(saveEnabled("Asha", null)).toBe(true);
  });
});

describe("identityRows", () => {
  const profile = { firstName: "Asha", lastName: "Rao", dateOfBirth: "1990-01-31T00:00:00.000Z", aadhaar: "123412341234", pan: "ABCDE1234F", address: "1 Main Rd", country: "India" };
  it("lists the identity in form order with the Aadhaar masked and the date trimmed", () => {
    expect(identityRows(profile)).toEqual([
      { id: "name", labelKey: "profile.field.name", value: "Asha Rao" },
      { id: "dateOfBirth", labelKey: "kyc.field.dateOfBirth", value: "1990-01-31" },
      { id: "aadhaar", labelKey: "kyc.field.aadhaar", value: "•••• •••• 1234" },
      { id: "pan", labelKey: "kyc.field.pan", value: "ABCDE1234F" },
      { id: "address", labelKey: "kyc.field.address", value: "1 Main Rd" },
      { id: "country", labelKey: "kyc.field.country", value: "India" },
    ]);
  });
  it("has a null value where nothing is on file", () => {
    const empty = identityRows({ firstName: null, lastName: null, dateOfBirth: null, aadhaar: null, pan: null, address: "", country: null });
    expect(empty.map((r) => r.value)).toEqual([null, null, null, null, null, null]);
  });
});
