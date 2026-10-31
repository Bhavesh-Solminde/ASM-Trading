// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { trackLogin, trackPixelCustomEvent } from "./MetaPixel";
import { AD_ENTRY_KEY } from "@/lib/ad-landing";

afterEach(() => { delete window.fbq; sessionStorage.clear(); vi.restoreAllMocks(); });

describe("Meta funnel events", () => {
  it("queues custom actions separately from standard Meta events", () => {
    const fbq = vi.fn();
    window.fbq = fbq as unknown as NonNullable<Window["fbq"]>;
    trackPixelCustomEvent("GetStarted", { placement: "hero", source: "ad_landing" });
    expect(fbq).toHaveBeenCalledWith("trackCustom", "GetStarted", { placement: "hero", source: "ad_landing" });
  });
  it("attributes a successful login to the bridge without sending account details", () => {
    const fbq = vi.fn();
    window.fbq = fbq as unknown as NonNullable<Window["fbq"]>;
    sessionStorage.setItem(AD_ENTRY_KEY, "/start");
    trackLogin("email");
    expect(fbq).toHaveBeenCalledWith("trackCustom", "Login", { method: "email", source: "ad_landing" });
  });
  it("handles direct logins and blocked browser storage", () => {
    const fbq = vi.fn();
    window.fbq = fbq as unknown as NonNullable<Window["fbq"]>;
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(() => trackLogin("google")).not.toThrow();
    expect(fbq).toHaveBeenCalledWith("trackCustom", "Login", { method: "google", source: "website" });
  });
  it("keeps navigation and authentication usable without a pixel", () => {
    expect(() => { trackLogin("email"); trackPixelCustomEvent("GetStarted"); }).not.toThrow();
  });
});
