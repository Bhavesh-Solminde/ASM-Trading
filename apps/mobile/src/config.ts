export interface AppConfig {
  apiUrl: string;
  wsUrl: string;
  version: string;
  variant: "play" | "direct";
  /** Google web OAuth client id; empty until the owner creates the clients (hides the Google button). */
  googleWebClientId: string;
}

interface ExpoLike {
  version?: string;
  extra?: { apiUrl?: string; wsUrl?: string; variant?: string; googleWebClientId?: string } | null;
}

export function configFrom(expo: ExpoLike): AppConfig {
  const extra = expo.extra ?? {};
  return {
    apiUrl: (extra.apiUrl ?? "").replace(/\/+$/, ""),
    wsUrl: extra.wsUrl ?? "",
    version: expo.version ?? "0.0.0",
    variant: extra.variant === "direct" ? "direct" : "play",
    googleWebClientId: extra.googleWebClientId ?? "",
  };
}

let cached: AppConfig | null = null;

/** Runtime config. Imports expo-constants lazily so this module stays testable in Node. */
export function appConfig(): AppConfig {
  if (!cached) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Constants = require("expo-constants").default as { expoConfig: ExpoLike | null };
    cached = configFrom(Constants.expoConfig ?? {});
  }
  return cached;
}
