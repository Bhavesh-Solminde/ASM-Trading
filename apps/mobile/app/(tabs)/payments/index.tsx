import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { color } from "@/theme/tokens";
import { Screen, Txt } from "@/theme/ui";
import { TabHeader } from "@/trade/TabHeader";

export default function Payments() {
  const { t } = useTranslation();
  return (
    <Screen bleedTop>
      <TabHeader />
      <View style={{ paddingHorizontal: 20, paddingTop: 24, gap: 8 }}>
        <Txt weight={600} size={24} accessibilityRole="header">
          {t("tabs.payments")}
        </Txt>
        <Txt size={15} color={color.ink2}>
          {t("tabs.soon")}
        </Txt>
      </View>
    </Screen>
  );
}
