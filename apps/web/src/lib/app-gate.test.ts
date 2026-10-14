import { describe, expect, it } from "vitest";
import { appUpgradeRequired } from "./app-gate";

const h = (v?: string) => new Headers(v ? { "x-client": `app/${v}` } : {});
const env = { APP_MIN_VERSION: "1.2.0" };

describe("appUpgradeRequired", () => {
  it("blocks an app older than the minimum on API calls", () => {
    expect(appUpgradeRequired("/api/v1/wallet", h("1.1.9"), env)).toBe(true);
  });
  it("lets the minimum version and newer through", () => {
    expect(appUpgradeRequired("/api/v1/wallet", h("1.2.0"), env)).toBe(false);
  });
  it("always lets the app read its config so it can show the update screen", () => {
    expect(appUpgradeRequired("/api/v1/app/config", h("0.1.0"), env)).toBe(false);
  });
  it("never affects the website or non-API paths", () => {
    expect(appUpgradeRequired("/api/v1/wallet", h(), env)).toBe(false);
    expect(appUpgradeRequired("/trade", h("0.1.0"), env)).toBe(false);
  });
  it("is off when no minimum is configured", () => {
    expect(appUpgradeRequired("/api/v1/wallet", h("0.0.1"), {})).toBe(false);
  });
});
