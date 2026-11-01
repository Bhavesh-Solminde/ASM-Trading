import { describe, expect, it } from "vitest";
import { registrationHref } from "./ad-landing";

describe("ad landing destination", () => {
  it("sends visitors directly to registration", () => {
    expect(registrationHref({})).toBe("/register");
  });
  it("preserves Meta and UTM attribution while dropping unknown or sensitive parameters", () => {
    const href = registrationHref({ utm_source: "instagram", utm_campaign: "Demo & learn", fbclid: "click-id", email: "private@example.com", next: "https://evil.test" });
    const destination = new URL(href, "https://indianxtrade.com");
    expect(destination.pathname).toBe("/register");
    expect(Object.fromEntries(destination.searchParams)).toEqual({ utm_source: "instagram", utm_campaign: "Demo & learn", fbclid: "click-id" });
  });
  it("ignores ambiguous repeated or oversized campaign values", () => {
    expect(registrationHref({ utm_source: ["facebook", "instagram"], fbclid: "x".repeat(501) })).toBe("/register");
  });
});
