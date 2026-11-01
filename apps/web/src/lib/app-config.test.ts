import { describe, expect, it } from "vitest";
import { AppConfigSchema } from "@asm/contracts";
import { appConfigFromEnv } from "./app-config";

describe("appConfigFromEnv", () => {
  it("uses safe defaults when nothing is configured", () => {
    expect(appConfigFromEnv({})).toEqual({
      minVersion: "0.0.0",
      latestVersion: "0.0.0",
      apkUrl: "/download/app",
      playUrl: null,
      playLive: false,
      support: { whatsapp: null, telegram: null },
      upiAppBlocklist: [],
    });
  });

  it("reads versions, Play status and support links", () => {
    const cfg = appConfigFromEnv({
      APP_MIN_VERSION: "1.0.0",
      APP_LATEST_VERSION: "1.3.0",
      APP_PLAY_URL: "https://play.google.com/store/apps/details?id=com.indianxtrade.app",
      APP_PLAY_LIVE: "1",
      SUPPORT_WHATSAPP: "https://wa.me/910000000000",
    });
    expect(cfg).toMatchObject({ minVersion: "1.0.0", latestVersion: "1.3.0", playLive: true });
    expect(cfg.support.whatsapp).toBe("https://wa.me/910000000000");
  });

  it("ignores a malformed version instead of breaking the app", () => {
    expect(appConfigFromEnv({ APP_MIN_VERSION: "v1" }).minVersion).toBe("0.0.0");
  });

  describe("UPI_APP_BLOCKLIST", () => {
    it("is empty when unset or blank", () => {
      expect(appConfigFromEnv({}).upiAppBlocklist).toEqual([]);
      expect(appConfigFromEnv({ UPI_APP_BLOCKLIST: "" }).upiAppBlocklist).toEqual([]);
      expect(appConfigFromEnv({ UPI_APP_BLOCKLIST: "  " }).upiAppBlocklist).toEqual([]);
    });

    it("reads a comma-separated list of the three apps", () => {
      expect(appConfigFromEnv({ UPI_APP_BLOCKLIST: "gpay,paytm" }).upiAppBlocklist).toEqual(["gpay", "paytm"]);
      expect(appConfigFromEnv({ UPI_APP_BLOCKLIST: "phonepe" }).upiAppBlocklist).toEqual(["phonepe"]);
    });

    it("ignores case and spaces, and drops names it does not know (including the chooser)", () => {
      expect(appConfigFromEnv({ UPI_APP_BLOCKLIST: " GPay , bhim,any,, PhonePe " }).upiAppBlocklist).toEqual(["gpay", "phonepe"]);
    });

    it("lists an app once however often it is named", () => {
      expect(appConfigFromEnv({ UPI_APP_BLOCKLIST: "gpay,gpay,Gpay" }).upiAppBlocklist).toEqual(["gpay"]);
    });

    it("always passes the contract the route parses it with", () => {
      expect(AppConfigSchema.parse(appConfigFromEnv({ UPI_APP_BLOCKLIST: "gpay,nonsense" })).upiAppBlocklist).toEqual(["gpay"]);
    });
  });
});
