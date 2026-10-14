import type { AppConfig } from "@asm/contracts";

const SEMVER = /^\d+\.\d+\.\d+$/;
const ON = new Set(["1", "true", "on", "yes"]);

function version(raw: string | undefined): string {
  const v = raw?.trim() ?? "";
  return SEMVER.test(v) ? v : "0.0.0";
}

function link(raw: string | undefined): string | null {
  const v = raw?.trim();
  return v ? v : null;
}

export function appConfigFromEnv(env: Record<string, string | undefined> = process.env): AppConfig {
  return {
    minVersion: version(env["APP_MIN_VERSION"]),
    latestVersion: version(env["APP_LATEST_VERSION"]),
    apkUrl: "/download/app",
    playUrl: link(env["APP_PLAY_URL"]),
    playLive: ON.has((env["APP_PLAY_LIVE"] ?? "").trim().toLowerCase()),
    support: { whatsapp: link(env["SUPPORT_WHATSAPP"]), telegram: link(env["SUPPORT_TELEGRAM"]) },
  };
}
