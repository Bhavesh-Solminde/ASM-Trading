import { describe, expect, it } from "vitest";
import { programActionBlockers } from "./program-wallet";

const user = { status: "ACTIVE", role: "USER", legacySimulated: false, kycStatus: "NOT_STARTED" as const, affiliateProfile: null };

describe("programActionBlockers", () => {
  it("asks for KYC on withdraw only while the switch is on", () => {
    expect(programActionBlockers(user, "withdraw", true)).toEqual(["kyc_required"]);
    expect(programActionBlockers(user, "withdraw", true, false)).toEqual([]);
  });
});
