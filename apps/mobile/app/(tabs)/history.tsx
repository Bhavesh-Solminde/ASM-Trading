import { useTranslation } from "react-i18next";
import { color } from "@/theme/tokens";
import { Screen, Txt } from "@/theme/ui";

export default function History() {
  const { t } = useTranslation();
  return (
    <Screen style={{ paddingHorizontal: 20, paddingTop: 24, gap: 8 }}>
      <Txt weight={600} size={24} accessibilityRole="header">
        {t("tabs.history")}
      </Txt>
      <Txt size={15} color={color.ink2}>
        {t("tabs.soon")}
      </Txt>
    </Screen>
  );
}
