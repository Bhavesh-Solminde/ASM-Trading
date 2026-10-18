import { describe, expect, it } from "vitest";
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
});
