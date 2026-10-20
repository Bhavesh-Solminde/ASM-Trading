import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./en.json";
import hi from "./hi.json";
import type { Locale } from "./keys";

export function initI18n(locale: Locale): void {
  if (i18n.isInitialized) return;
  void i18n.use(initReactI18next).init({
    resources: { en: { translation: en }, hi: { translation: hi } },
    lng: locale,
    fallbackLng: "en",
    interpolation: { escapeValue: false },
  });
}

export async function setLocale(locale: Locale): Promise<void> {
  await i18n.changeLanguage(locale);
}

export { localeFromDevice, resolveLocale, type Locale } from "./keys";
