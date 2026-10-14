import { useTranslation } from "react-i18next";
import { space } from "@/theme/tokens";
import { Screen, Txt } from "@/theme/ui";

export default function Payments() {
  const { t } = useTranslation();
  return (
    <Screen style={{ padding: space(4) }}>
      <Txt variant="title" accessibilityRole="header">
        {t("tabs.payments")}
      </Txt>
    </Screen>
  );
}
