import type { Locale } from "./keys";

/** The app's active language as the two locales the server knows: "hi", "hi-IN" and so on are hi, anything else en. */
export function activeLocale(language: string): Locale {
  return language.toLowerCase().startsWith("hi") ? "hi" : "en";
}

/**
 * Whether to tell the server the app's language. Only with a live session (hydrated, signed in, unlocked) and a
 * loaded bootstrap that disagrees, and never for a value whose request is still running.
 */
export function shouldSyncLocale(args: {
  serverLocale: Locale | null | undefined;
  appLocale: Locale;
  sessionLive: boolean;
  inFlight: Locale | null;
}): boolean {
  const { serverLocale, appLocale, sessionLive, inFlight } = args;
  if (!sessionLive || !serverLocale) return false;
  return serverLocale !== appLocale && inFlight !== appLocale;
}
