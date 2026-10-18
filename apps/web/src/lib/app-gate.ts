import { appVersionFrom, compareVersions } from "./app-client";

const SEMVER = /^\d+\.\d+\.\d+$/;
const ALWAYS_OPEN = new Set(["/api/v1/app/config"]);

/** True when an app build older than APP_MIN_VERSION calls the API. */
export function appUpgradeRequired(
  pathname: string,
  headers: Pick<Headers, "get">,
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (!pathname.startsWith("/api/") || ALWAYS_OPEN.has(pathname)) return false;
  const min = env["APP_MIN_VERSION"]?.trim() ?? "";
  if (!SEMVER.test(min)) return false;
  const version = appVersionFrom(headers);
  return version !== null && compareVersions(version, min) < 0;
}
