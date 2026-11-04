export type DeviceKind =
  | "iphone-safari"
  | "iphone-other"
  | "android-phone"
  | "other";
const DAY = 86_400_000;
export function deviceKind(ua: string): DeviceKind {
  if (/iPhone/i.test(ua))
    return /Version\/.*Safari/i.test(ua) &&
      !/CriOS|FxiOS|EdgiOS|OPiOS|Instagram|FBAN|FBAV|GSA\//i.test(ua)
      ? "iphone-safari"
      : "iphone-other";
  return /Android/i.test(ua) &&
    /Mobile/i.test(ua) &&
    !/; wv\)|Instagram|FBAN|FBAV/i.test(ua)
    ? "android-phone"
    : "other";
}
export function isStandalone(env: {
  displayModeStandalone: boolean;
  navigatorStandalone?: boolean | undefined;
}): boolean {
  return env.displayModeStandalone || env.navigatorStandalone === true;
}
/** Only the signed-in product routes can offer installation; unknown/public routes fail closed. */
export function isPublicPath(path: string): boolean {
  return !/^\/(trade|history|account|payments|deposit|withdraw|balance|leaderboard)(\/|$)/.test(
    path,
  );
}
export function showIosInstallSheet(s: {
  kind: DeviceKind;
  standalone: boolean;
  loggedIn: boolean;
  pathname: string;
  lastShownAt: number | null;
  dismissedForever: boolean;
  now: number;
}): boolean {
  return (
    s.kind === "iphone-safari" &&
    !s.standalone &&
    s.loggedIn &&
    !s.dismissedForever &&
    !isPublicPath(s.pathname) &&
    (s.lastShownAt === null || s.now - s.lastShownAt >= 7 * DAY)
  );
}
export function showGetAppBar(s: {
  kind: DeviceKind;
  standalone: boolean;
  loggedIn: boolean;
  pathname: string;
  dismissedAt: number | null;
  now: number;
}): boolean {
  return (
    s.kind === "android-phone" &&
    !s.standalone &&
    s.loggedIn &&
    !isPublicPath(s.pathname) &&
    (s.dismissedAt === null || s.now - s.dismissedAt >= 14 * DAY)
  );
}
export function canOfferWebPush(s: {
  standalone: boolean;
  hasPushManager: boolean;
  hasNotification: boolean;
}): boolean {
  return s.standalone && s.hasPushManager && s.hasNotification;
}
export function browserStandalone(): boolean {
  return isStandalone({
    displayModeStandalone: window.matchMedia("(display-mode: standalone)")
      .matches,
    navigatorStandalone: (navigator as Navigator & { standalone?: boolean })
      .standalone,
  });
}
export function appDownloadTarget(config: {
  playLive: boolean;
  playUrl: string | null;
  apkUrl: string;
}): string {
  if (
    config.playLive &&
    config.playUrl?.startsWith("https://play.google.com/store/apps/")
  )
    return config.playUrl;
  return config.apkUrl.startsWith("/") && !config.apkUrl.startsWith("//")
    ? config.apkUrl
    : "/download/app";
}
