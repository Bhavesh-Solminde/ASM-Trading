import { describe, expect, it } from "vitest";
import {
  appDownloadTarget,
  canOfferWebPush,
  deviceKind,
  isPublicPath,
  showIosInstallSheet,
  showGetAppBar,
} from "./install-rules";
const DAY = 86400000,
  now = 100 * DAY;
describe("installation eligibility", () => {
  it("distinguishes Safari, embedded browsers, phones and tablets", () => {
    expect(deviceKind("iPhone Version/17 Safari/604")).toBe("iphone-safari");
    for (const ua of [
      "iPhone CriOS/123 Safari/604",
      "iPhone Instagram Version/17 Safari/604",
      "iPhone FBAV Version/17 Safari/604",
    ])
      expect(deviceKind(ua)).toBe("iphone-other");
    expect(deviceKind("Android Chrome Mobile Safari")).toBe("android-phone");
    expect(deviceKind("Android Chrome Safari")).toBe("other");
  });
  it("never prompts on public or unknown pages", () => {
    for (const path of [
      "/",
      "/guides/x",
      "/compare/x",
      "/legal",
      "/about",
      "/security",
      "/login",
      "/unknown",
    ])
      expect(isPublicPath(path)).toBe(true);
    expect(isPublicPath("/account/verify")).toBe(false);
  });
  it("enforces seven days and permanent iOS dismissal", () => {
    const b = {
      kind: "iphone-safari" as const,
      standalone: false,
      loggedIn: true,
      pathname: "/trade",
      lastShownAt: null,
      dismissedForever: false,
      now,
    };
    expect(showIosInstallSheet(b)).toBe(true);
    expect(showIosInstallSheet({ ...b, lastShownAt: now - 6 * DAY })).toBe(
      false,
    );
    expect(showIosInstallSheet({ ...b, lastShownAt: now - 7 * DAY })).toBe(
      true,
    );
    for (const patch of [
      { standalone: true },
      { loggedIn: false },
      { pathname: "/" },
      { dismissedForever: true },
    ])
      expect(showIosInstallSheet({ ...b, ...patch })).toBe(false);
  });
  it("enforces fourteen days for the Android bar", () => {
    const b = {
      kind: "android-phone" as const,
      standalone: false,
      loggedIn: true,
      pathname: "/history",
      dismissedAt: null,
      now,
    };
    expect(showGetAppBar(b)).toBe(true);
    expect(showGetAppBar({ ...b, dismissedAt: now - 13 * DAY })).toBe(false);
    expect(showGetAppBar({ ...b, dismissedAt: now - 14 * DAY })).toBe(true);
    expect(showGetAppBar({ ...b, standalone: true })).toBe(false);
  });
  it("only offers push inside a capable installed app", () => {
    expect(
      canOfferWebPush({
        standalone: true,
        hasPushManager: true,
        hasNotification: true,
      }),
    ).toBe(true);
    expect(
      canOfferWebPush({
        standalone: false,
        hasPushManager: true,
        hasNotification: true,
      }),
    ).toBe(false);
  });
  it("uses Play only when live and rejects remote APK targets", () => {
    expect(
      appDownloadTarget({
        playLive: true,
        playUrl: "https://play.google.com/store/apps/details?id=x",
        apkUrl: "/download/app",
      }),
    ).toContain("play.google.com");
    expect(
      appDownloadTarget({
        playLive: false,
        playUrl: "https://play.google.com/store/apps/details?id=x",
        apkUrl: "//evil.test",
      }),
    ).toBe("/download/app");
  });
});
