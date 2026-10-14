import { useTranslation } from "react-i18next";
import { space } from "@/theme/tokens";
import { Screen, Txt } from "@/theme/ui";

export default function History() {
  const { t } = useTranslation();
  return (
    <Screen style={{ padding: space(4) }}>
      <Txt variant="title" accessibilityRole="header">
        {t("tabs.history")}
      </Txt>
    </Screen>
  );
}
