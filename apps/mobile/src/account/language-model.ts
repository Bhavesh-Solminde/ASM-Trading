import { activeLocale } from "@/i18n/locale-sync";
import type { Locale } from "@/i18n";

/** The two choices, each named in its own script so it can be found whatever language the app is in now. */
export const LANGUAGE_OPTIONS: ReadonlyArray<{ locale: Locale; labelKey: string; script: "latin" | "devanagari" }> = [
  { locale: "en", labelKey: "lang.en", script: "latin" },
  { locale: "hi", labelKey: "lang.hi", script: "devanagari" },
];

/** Whether `option` is the app's current language (`hi-IN` is Hindi; anything else is English, as the server reads it). */
export function languageSelected(language: string, option: Locale): boolean {
  return activeLocale(language) === option;
}
