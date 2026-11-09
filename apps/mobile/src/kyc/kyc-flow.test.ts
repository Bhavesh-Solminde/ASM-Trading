import { describe, expect, it } from "vitest";
import { KYC_IDENTITY_FIELDS } from "@asm/contracts";
import { KYC_GROUPS, detailsComplete, groupStates, nextKycStep, stepGroup } from "./kyc-flow";

const FULL = {
  firstName: "Asha",
  lastName: "Rao",
  dateOfBirth: "1990-01-31",
  aadhaar: "123412341234",
  pan: "ABCDE1234F",
  address: "12 MG Road, Pune",
  country: "India",
};

describe("detailsComplete", () => {
  it("is true when every identity field has a value", () => {
    expect(detailsComplete(FULL)).toBe(true);
  });
  it("is false when any one field is null, missing, empty or only spaces", () => {
    for (const field of KYC_IDENTITY_FIELDS) {
      expect(detailsComplete({ ...FULL, [field]: null })).toBe(false);
      expect(detailsComplete({ ...FULL, [field]: "" })).toBe(false);
      expect(detailsComplete({ ...FULL, [field]: "   " })).toBe(false);
      expect(detailsComplete(Object.fromEntries(Object.entries(FULL).filter(([k]) => k !== field)))).toBe(false);
    }
  });
  it("ignores fields that are not identity fields (nickname, email)", () => {
    const profile = { ...FULL, nickname: null, email: "a@b.co", emailVerified: true };
    expect(detailsComplete(profile)).toBe(true);
  });
});

describe("nextKycStep", () => {
  it("starts with personal details", () => {
    expect(nextKycStep({ detailsComplete: false, kycDocuments: [] })).toBe("details");
  });
  it("still asks for details first even when documents were uploaded earlier", () => {
    expect(nextKycStep({ detailsComplete: false, kycDocuments: ["PAN"] })).toBe("details");
  });
  it("asks for the first missing document in order", () => {
    expect(nextKycStep({ detailsComplete: true, kycDocuments: ["AADHAAR_FRONT", "PAN"] })).toBe("AADHAAR_BACK");
    expect(nextKycStep({ detailsComplete: true, kycDocuments: [] })).toBe("AADHAAR_FRONT");
  });
  it("goes to review once everything is uploaded", () => {
    expect(nextKycStep({ detailsComplete: true, kycDocuments: ["AADHAAR_FRONT", "AADHAAR_BACK", "PAN", "SELFIE"] })).toBe("review");
  });
});

describe("KYC_GROUPS", () => {
  it("lists the four cards in order: details, aadhaar (front then back), pan, selfie", () => {
    expect(KYC_GROUPS).toEqual([
      { id: "details", kinds: [] },
      { id: "aadhaar", kinds: ["AADHAAR_FRONT", "AADHAAR_BACK"] },
      { id: "pan", kinds: ["PAN"] },
      { id: "selfie", kinds: ["SELFIE"] },
    ]);
  });
});

describe("stepGroup", () => {
  it("maps each step to the card it belongs to; review belongs to none", () => {
    expect(stepGroup("details")).toBe("details");
    expect(stepGroup("AADHAAR_FRONT")).toBe("aadhaar");
    expect(stepGroup("AADHAAR_BACK")).toBe("aadhaar");
    expect(stepGroup("PAN")).toBe("pan");
    expect(stepGroup("SELFIE")).toBe("selfie");
    expect(stepGroup("review")).toBeNull();
  });
});

describe("groupStates", () => {
  it("marks the card holding the next step current, earlier ones done, later ones todo", () => {
    expect(groupStates({ detailsComplete: true, kycDocuments: ["AADHAAR_FRONT"] })).toEqual({
      details: "done",
      aadhaar: "current",
      pan: "todo",
      selfie: "todo",
    });
  });
  it("starts with details current", () => {
    expect(groupStates({ detailsComplete: false, kycDocuments: [] }).details).toBe("current");
  });
  it("marks every card done at review", () => {
    expect(groupStates({ detailsComplete: true, kycDocuments: ["AADHAAR_FRONT", "AADHAAR_BACK", "PAN", "SELFIE"] })).toEqual({
      details: "done",
      aadhaar: "done",
      pan: "done",
      selfie: "done",
    });
  });
  it("shows a later card done when its photo exists even though an earlier card is current", () => {
    // Re-upload after a rejection: the server list drives it, not the order they were taken in.
    expect(groupStates({ detailsComplete: true, kycDocuments: ["SELFIE"] }).selfie).toBe("done");
  });
});
