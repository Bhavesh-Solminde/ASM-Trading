import { describe, expect, it } from "vitest";
import { ApiError } from "@/api/errors";
import { KYC_STEP_CTA_KEYS, cardPress, detailsEditable, kycRequestErrorText, stepCta, verifyCards, verifyPhase } from "./verify-model";

const DOCS = ["AADHAAR_FRONT", "AADHAAR_BACK", "PAN", "SELFIE"] as const;

describe("verifyPhase", () => {
  it("shows the done card for VERIFIED and the review card for PENDING, whatever else is set", () => {
    expect(verifyPhase("VERIFIED", true)).toBe("verified");
    expect(verifyPhase("PENDING", true)).toBe("pending");
  });
  it("starts the steps for a user who has not begun", () => {
    expect(verifyPhase("NOT_STARTED", false)).toBe("flow");
  });
  it("shows the rejection first, and the steps once the user starts again", () => {
    expect(verifyPhase("REJECTED", false)).toBe("rejected");
    expect(verifyPhase("REJECTED", true)).toBe("flow");
  });
});

describe("detailsEditable", () => {
  it("is false while the server holds the details (PENDING, VERIFIED) and true otherwise", () => {
    expect(detailsEditable("PENDING")).toBe(false);
    expect(detailsEditable("VERIFIED")).toBe(false);
    expect(detailsEditable("NOT_STARTED")).toBe(true);
    expect(detailsEditable("REJECTED")).toBe(true);
  });
});

describe("stepCta", () => {
  it("labels the main button after the next step and says what it does", () => {
    expect(stepCta("details")).toEqual({ labelKey: "kyc.cta.details", action: { type: "details" } });
    expect(stepCta("AADHAAR_FRONT")).toEqual({ labelKey: "kyc.cta.AADHAAR_FRONT", action: { type: "capture", kind: "AADHAAR_FRONT" } });
    expect(stepCta("AADHAAR_BACK")).toEqual({ labelKey: "kyc.cta.AADHAAR_BACK", action: { type: "capture", kind: "AADHAAR_BACK" } });
    expect(stepCta("PAN")).toEqual({ labelKey: "kyc.cta.PAN", action: { type: "capture", kind: "PAN" } });
    expect(stepCta("SELFIE")).toEqual({ labelKey: "kyc.cta.SELFIE", action: { type: "capture", kind: "SELFIE" } });
    expect(stepCta("review")).toEqual({ labelKey: "kyc.cta.review", action: { type: "submit" } });
  });
  it("has a label key for every step", () => {
    expect(Object.keys(KYC_STEP_CTA_KEYS).sort()).toEqual(["AADHAAR_BACK", "AADHAAR_FRONT", "PAN", "SELFIE", "details", "review"]);
  });
});

describe("verifyCards", () => {
  it("lists four cards in order, numbered 1 to 4, with the details card current for a new user", () => {
    const cards = verifyCards({ detailsComplete: false, kycDocuments: [] });
    expect(cards.map((c) => c.id)).toEqual(["details", "aadhaar", "pan", "selfie"]);
    expect(cards.map((c) => c.number)).toEqual([1, 2, 3, 4]);
    expect(cards.map((c) => c.state)).toEqual(["current", "todo", "todo", "todo"]);
  });
  it("gives each card its title, subtitle and icon", () => {
    const [details, aadhaar, pan, selfie] = verifyCards({ detailsComplete: false, kycDocuments: [] });
    expect(details).toMatchObject({ titleKey: "kyc.card.details.title", subtitleKey: "kyc.card.details.sub", icon: "user" });
    expect(aadhaar).toMatchObject({ titleKey: "kyc.card.aadhaar.title", subtitleKey: "kyc.card.aadhaar.sub", icon: "idCard" });
    expect(pan).toMatchObject({ titleKey: "kyc.card.pan.title", subtitleKey: "kyc.card.pan.sub", icon: "creditCard" });
    expect(selfie).toMatchObject({ titleKey: "kyc.card.selfie.title", subtitleKey: "kyc.card.selfie.sub", icon: "scanFace" });
  });
  it("moves 'current' along as photos arrive, with Aadhaar done only when both sides are on file", () => {
    expect(verifyCards({ detailsComplete: true, kycDocuments: ["AADHAAR_FRONT"] }).map((c) => c.state)).toEqual(["done", "current", "todo", "todo"]);
    expect(verifyCards({ detailsComplete: true, kycDocuments: ["AADHAAR_FRONT", "AADHAAR_BACK"] }).map((c) => c.state)).toEqual(["done", "done", "current", "todo"]);
  });
  it("has no current card once everything is in (the next step is review)", () => {
    expect(verifyCards({ detailsComplete: true, kycDocuments: [...DOCS] }).map((c) => c.state)).toEqual(["done", "done", "done", "done"]);
  });
});

describe("cardPress", () => {
  const all = [...DOCS];
  it("does nothing on a card that is not reachable yet", () => {
    expect(cardPress("pan", "todo", [])).toEqual({ type: "none" });
  });
  it("opens the form on the details card, whether it is current or done", () => {
    expect(cardPress("details", "current", [])).toEqual({ type: "details" });
    expect(cardPress("details", "done", all)).toEqual({ type: "details" });
  });
  it("opens the camera for the missing photo on the current card", () => {
    expect(cardPress("aadhaar", "current", [])).toEqual({ type: "capture", kind: "AADHAAR_FRONT" });
    expect(cardPress("aadhaar", "current", ["AADHAAR_FRONT"])).toEqual({ type: "capture", kind: "AADHAAR_BACK" });
    expect(cardPress("pan", "current", [])).toEqual({ type: "capture", kind: "PAN" });
  });
  it("retakes the one photo of a done single-photo card", () => {
    expect(cardPress("pan", "done", all)).toEqual({ type: "capture", kind: "PAN" });
    expect(cardPress("selfie", "done", all)).toEqual({ type: "capture", kind: "SELFIE" });
  });
  it("asks which side to retake on a done Aadhaar card", () => {
    expect(cardPress("aadhaar", "done", all)).toEqual({ type: "chooseSide" });
  });
});

describe("kycRequestErrorText", () => {
  const t = (key: string) => `<${key}>`;
  it("translates offline and a timeout, naming the timeout's own key", () => {
    expect(kycRequestErrorText(new ApiError("No connection.", 0, "offline"), t, "kyc.submitTimedOut")).toBe("<common.noConnection>");
    expect(kycRequestErrorText(new ApiError("The request timed out.", 0, "timeout"), t, "kyc.submitTimedOut")).toBe("<kyc.submitTimedOut>");
  });
  it("shows the server's own message on a 4xx: the 400 about missing items, the 409 about a frozen submission", () => {
    expect(kycRequestErrorText(new ApiError("Some details or documents are still missing.", 400, null), t, "x")).toBe("Some details or documents are still missing.");
    expect(kycRequestErrorText(new ApiError("Your verification is already in review or approved.", 409, null), t, "x")).toBe("Your verification is already in review or approved.");
  });
  it("says something went wrong for a 5xx, a message-less error or anything that is not an ApiError", () => {
    expect(kycRequestErrorText(new ApiError("Boom", 500, null), t, "x")).toBe("<common.genericError>");
    expect(kycRequestErrorText(new ApiError("Something went wrong.", 400, null), t, "x")).toBe("<common.genericError>");
    expect(kycRequestErrorText(new Error("x"), t, "x")).toBe("<common.genericError>");
  });
});
