import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { setLocale, type Locale } from "@/i18n";
import { saveLocale } from "@/i18n/locale-pref";
import { Chip } from "./Chip";

/** English / हिन्दी on the first screen; many users read Hindi first. Each label is set in its own script. */
export function LanguageSwitch() {
  const { t, i18n } = useTranslation();
  const current: Locale = i18n.language.startsWith("hi") ? "hi" : "en";
  const pick = (locale: Locale) => {
    saveLocale(locale);
    void setLocale(locale);
  };
  return (
    <View
      accessibilityRole="radiogroup"
      style={{ flexDirection: "row", justifyContent: "center", gap: 6, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 28 }}
    >
      <Chip role="radio" label={t("lang.en")} script="latin" height={36} selected={current === "en"} onPress={() => pick("en")} style={{ paddingHorizontal: 16 }} />
      <Chip
        role="radio"
        label={t("lang.hi")}
        script="devanagari"
        size={15}
        height={36}
        selected={current === "hi"}
        onPress={() => pick("hi")}
        style={{ paddingHorizontal: 16 }}
      />
    </View>
  );
}
