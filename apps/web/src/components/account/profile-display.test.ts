import { describe, expect, it } from "vitest";
import { displayName, initialsFor, kycBadge } from "./profile-display";

describe("displayName", () => {
  it("prefers the verified full name", () => {
    expect(displayName({ firstName: "Asha", lastName: "Rao", nickname: "ash", email: "a@x.com" })).toBe("Asha Rao");
  });
  it("falls back to the nickname, then the email local part", () => {
    expect(displayName({ firstName: null, lastName: null, nickname: " ash ", email: "a@x.com" })).toBe("ash");
    expect(displayName({ firstName: null, lastName: "  ", nickname: null, email: "test10@asmtrade.local" })).toBe("test10");
  });
});

describe("initialsFor", () => {
  it("uses first and last word", () => {
    expect(initialsFor("Asha Rao")).toBe("AR");
    expect(initialsFor("Asha Devi Rao")).toBe("AR");
  });
  it("uses the first two characters of a single word", () => {
    expect(initialsFor("test10")).toBe("TE");
    expect(initialsFor("x")).toBe("X");
  });
  it("never returns an empty string", () => {
    expect(initialsFor("")).toBe("?");
  });
});

describe("kycBadge", () => {
  it("maps each status to a tone and defaults unknown values to not verified", () => {
    expect(kycBadge("VERIFIED").tone).toBe("up");
    expect(kycBadge("PENDING").tone).toBe("caution");
    expect(kycBadge("REJECTED").tone).toBe("down");
    expect(kycBadge("???").label).toBe("Not verified");
  });
});
