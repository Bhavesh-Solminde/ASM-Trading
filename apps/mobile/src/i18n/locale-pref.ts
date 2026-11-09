import { openMmkv } from "@/cache/mmkv";
import type { Locale } from "./keys";

/** In the prefs store (not the resume store), so the choice survives sign-out. Best effort both ways. */
const KEY = "locale";

export function loadLocale(): string | null {
  try {
    return openMmkv("ixt-prefs")?.getString(KEY) ?? null;
  } catch {
    return null;
  }
}

export function saveLocale(locale: Locale): void {
  try {
    openMmkv("ixt-prefs")?.set(KEY, locale);
  } catch {
    // The switch still applies for this session.
  }
}
