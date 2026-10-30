import { describe, expect, it } from "vitest";
import { demoAccountId, identityInitials, identityName, kycTag, liveCurrency, lockValueKey, showVerifyCard } from "./hub-model";

describe("identityName", () => {
  it("is the first and last name when there is one", () => {
    expect(identityName({ firstName: "Asha", lastName: "Rao", nickname: "ash", email: "asha@x.co" })).toBe("Asha Rao");
  });
  it("is whichever of first and last name is there", () => {
    expect(identityName({ firstName: "Asha", lastName: null, nickname: "ash", email: "asha@x.co" })).toBe("Asha");
    expect(identityName({ firstName: " ", lastName: "Rao", nickname: null, email: "a@x.co" })).toBe("Rao");
  });
  it("falls back to the nickname, then to the part of the email before the @", () => {
    expect(identityName({ firstName: null, lastName: null, nickname: "ash", email: "asha@x.co" })).toBe("ash");
    expect(identityName({ firstName: "", lastName: "", nickname: "  ", email: "asha.rao@x.co" })).toBe("asha.rao");
  });
  it("is empty when nothing is known yet", () => {
    expect(identityName({ firstName: null, lastName: null, nickname: null, email: "" })).toBe("");
  });
});

describe("identityInitials", () => {
  it("takes the first letter of the first two words, in capitals", () => {
    expect(identityInitials("Asha Rao")).toBe("AR");
    expect(identityInitials("asha mary rao")).toBe("AM");
  });
  it("takes one letter from a single word and none from nothing", () => {
    expect(identityInitials("asha.rao")).toBe("A");
    expect(identityInitials("")).toBe("");
    expect(identityInitials("   ")).toBe("");
  });
  it("works on whole characters in Devanagari", () => {
    expect(identityInitials("आशा राव")).toBe("आर");
  });
  it("does not split an emoji", () => {
    expect(identityInitials("😀 Bob")).toBe("😀B");
  });
});

describe("kycTag", () => {
  it("maps each status to a tone and a label key", () => {
    expect(kycTag("VERIFIED")).toEqual({ tone: "up", labelKey: "account.kycVerified" });
    expect(kycTag("PENDING")).toEqual({ tone: "caution", labelKey: "account.kycReview" });
    expect(kycTag("REJECTED")).toEqual({ tone: "down", labelKey: "account.kycRejected" });
    expect(kycTag("NOT_STARTED")).toEqual({ tone: "neutral", labelKey: "account.kycNotDone" });
  });
});

describe("showVerifyCard", () => {
  it("shows only while there is something to do", () => {
    expect(showVerifyCard("NOT_STARTED")).toBe(true);
    expect(showVerifyCard("REJECTED")).toBe(true);
    expect(showVerifyCard("PENDING")).toBe(false);
    expect(showVerifyCard("VERIFIED")).toBe(false);
  });
});

describe("lockValueKey", () => {
  it("names the unlock method, or Off", () => {
    expect(lockValueKey({ enabled: true, method: "biometric" })).toBe("account.lockFingerprint");
    expect(lockValueKey({ enabled: true, method: "pin" })).toBe("account.lockPin");
    expect(lockValueKey({ enabled: false, method: "pin" })).toBe("account.lockOff");
    expect(lockValueKey({ enabled: false, method: null })).toBe("account.lockOff");
    expect(lockValueKey({ enabled: true, method: null })).toBe("account.lockOff");
  });
});

const accounts = [
  { id: "d1", type: "DEMO" as const, currency: "INR" },
  { id: "l1", type: "LIVE" as const, currency: "USD" },
];

describe("liveCurrency", () => {
  it("is the LIVE account's currency", () => {
    expect(liveCurrency(accounts)).toBe("USD");
  });
  it("is null without a live account (never the demo one)", () => {
    expect(liveCurrency([accounts[0]!])).toBeNull();
    expect(liveCurrency(undefined)).toBeNull();
  });
});

describe("demoAccountId", () => {
  it("is the DEMO account's id", () => {
    expect(demoAccountId(accounts)).toBe("d1");
  });
  it("is null without one (so the reset row is not offered, and a LIVE id is never sent)", () => {
    expect(demoAccountId([accounts[1]!])).toBeNull();
    expect(demoAccountId(undefined)).toBeNull();
    expect(demoAccountId([])).toBeNull();
  });
});
