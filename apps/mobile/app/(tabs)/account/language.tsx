import { Pressable, View } from "react-native";
import { useTranslation } from "react-i18next";
import { LANGUAGE_OPTIONS, languageSelected } from "@/account/language-model";
import { setLocale, type Locale } from "@/i18n";
import { saveLocale } from "@/i18n/locale-pref";
import { color } from "@/theme/tokens";
import { Screen, Txt } from "@/theme/ui";
import { BackHeader } from "@/ui/BackHeader";
import { Icon } from "@/ui/Icon";

/**
 * Language: English or हिन्दी. It only changes the app's language (and remembers it); the server's copy of the choice
 * (it sets the language of push notifications) follows by itself through the locale sync (`useLocaleSync`), so there
 * is no request here.
 */
export default function Language() {
  const { t, i18n } = useTranslation();
  const pick = (locale: Locale) => {
    if (languageSelected(i18n.language, locale)) return;
    saveLocale(locale);
    void setLocale(locale);
  };
  return (
    <Screen>
      <View style={{ padding: 20, gap: 20 }}>
        <BackHeader title={t("language.title")} />
        <Txt size={14} color={color.ink2}>
          {t("language.hint")}
        </Txt>
        <View accessibilityRole="radiogroup" style={{ backgroundColor: color.surface, borderRadius: 14, paddingHorizontal: 16 }}>
          {LANGUAGE_OPTIONS.map((option, i) => {
            const selected = languageSelected(i18n.language, option.locale);
            return (
              <Pressable
                key={option.locale}
                testID={`language-${option.locale}`}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                accessibilityLabel={t(option.labelKey)}
                onPress={() => pick(option.locale)}
                style={({ pressed }) => ({
                  minHeight: 56,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 12,
                  borderTopWidth: i === 0 ? 0 : 1,
                  borderTopColor: color.rule,
                  opacity: pressed ? 0.85 : 1,
                })}
              >
                <Txt size={16} weight={selected ? 600 : 400} script={option.script} style={{ flex: 1 }}>
                  {t(option.labelKey)}
                </Txt>
                <View style={{ width: 24, height: 24, alignItems: "center", justifyContent: "center" }}>{selected ? <Icon name="check" size={20} color={color.accentText} strokeWidth={2.25} /> : null}</View>
              </Pressable>
            );
          })}
        </View>
      </View>
    </Screen>
  );
}
