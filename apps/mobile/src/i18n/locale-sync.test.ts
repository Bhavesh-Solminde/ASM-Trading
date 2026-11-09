import { describe, expect, it } from "vitest";
import { activeLocale, shouldSyncLocale } from "./locale-sync";

const base = { serverLocale: "en", appLocale: "hi", sessionLive: true, inFlight: null } as const;

describe("activeLocale", () => {
  it("maps the i18n language to en or hi", () => {
    expect(activeLocale("hi")).toBe("hi");
    expect(activeLocale("hi-IN")).toBe("hi");
    expect(activeLocale("en")).toBe("en");
    expect(activeLocale("en-US")).toBe("en");
    expect(activeLocale("")).toBe("en");
  });
});

describe("shouldSyncLocale", () => {
  it("sends when the server's locale differs from the app's", () => {
    expect(shouldSyncLocale(base)).toBe(true);
    expect(shouldSyncLocale({ ...base, serverLocale: "hi", appLocale: "en" })).toBe(true);
  });
  it("does not send when they already match", () => {
    expect(shouldSyncLocale({ ...base, serverLocale: "hi" })).toBe(false);
  });
  it("does not send before the bootstrap has loaded", () => {
    expect(shouldSyncLocale({ ...base, serverLocale: undefined })).toBe(false);
    expect(shouldSyncLocale({ ...base, serverLocale: null })).toBe(false);
  });
  it("does not send while signed out, locked or before the session has hydrated", () => {
    expect(shouldSyncLocale({ ...base, sessionLive: false })).toBe(false);
  });
  it("does not send a value that is already in flight", () => {
    expect(shouldSyncLocale({ ...base, inFlight: "hi" })).toBe(false);
  });
  it("sends the new value when a different one is in flight", () => {
    expect(shouldSyncLocale({ ...base, inFlight: "en" })).toBe(true);
  });
});
