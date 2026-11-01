import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { color } from "@/theme/tokens";
import { Screen, Txt } from "@/theme/ui";
import { BackHeader } from "@/ui/BackHeader";

/** A stub until push notifications ship; the route stays (`/account/notifications`) because the notification screen replaces this file. */
export default function Notifications() {
  const { t } = useTranslation();
  return (
    <Screen>
      <View style={{ padding: 20, gap: 20 }}>
        <BackHeader title={t("notifications.title")} />
        <Txt testID="notifications-soon" size={15} color={color.ink2}>
          {t("notifications.soon")}
        </Txt>
      </View>
    </Screen>
  );
}
