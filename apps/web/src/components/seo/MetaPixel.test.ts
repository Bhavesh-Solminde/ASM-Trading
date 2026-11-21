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

describe("pixel IDs for static pages", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

  it("fetches the IDs once per page load and keeps only strings", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ pixelIds: ["1137830615432603", 5] })));
    vi.stubGlobal("fetch", fetchMock);
    const { fetchPixelIds } = await import("./MetaPixel");
    expect(await fetchPixelIds()).toEqual(["1137830615432603"]);
    expect(await fetchPixelIds()).toEqual(["1137830615432603"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/meta-pixel");
  });

  it("loads no pixel when the request fails or is refused", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    expect(await (await import("./MetaPixel")).fetchPixelIds()).toEqual([]);
    vi.resetModules();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 429 })));
    expect(await (await import("./MetaPixel")).fetchPixelIds()).toEqual([]);
  });
});
