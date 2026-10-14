export interface AppConfig {
  apiUrl: string;
  wsUrl: string;
  version: string;
  variant: "play" | "direct";
}

interface ExpoLike {
  version?: string;
  extra?: { apiUrl?: string; wsUrl?: string; variant?: string } | null;
}

export function configFrom(expo: ExpoLike): AppConfig {
  const extra = expo.extra ?? {};
  return {
    apiUrl: (extra.apiUrl ?? "").replace(/\/+$/, ""),
    wsUrl: extra.wsUrl ?? "",
    version: expo.version ?? "0.0.0",
    variant: extra.variant === "direct" ? "direct" : "play",
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
