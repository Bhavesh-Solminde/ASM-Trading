import { Tabs } from "expo-router/js-tabs";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { AppState } from "react-native";
import { queryClient } from "@/api/queries";
import { refreshBootstrap } from "@/api/refresh-bootstrap";
import { useSocket } from "@/socket/socket-store";
import { color } from "@/theme/tokens";
import { Icon, type IconName } from "@/ui/Icon";

const icon = (name: IconName) =>
  function TabIcon({ focused }: { focused: boolean }) {
    return <Icon name={name} color={focused ? color.brand : color.ink2} />;
  };

const tabIcons = {
  trade: icon("trade"),
  payments: icon("wallet"),
  history: icon("history"),
  account: icon("user"),
};

export default function TabsLayout() {
  const { t } = useTranslation();

  // One engine socket for the whole tab shell: open while the app is in the foreground, closed in the background.
  useEffect(() => {
    const { start, stop } = useSocket.getState();
    start();
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        start();
        // Settlements, deposits and withdrawals while backgrounded never reached the (closed) socket.
        refreshBootstrap(queryClient);
      }
      else if (state === "background") stop();
    });
    return () => {
      sub.remove();
      stop();
    };
  }, []);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        // No fixed height: React Navigation adds the bottom safe-area inset to the bar.
        tabBarStyle: { backgroundColor: color.panel, borderTopColor: color.rule },
        tabBarActiveTintColor: color.brand,
        tabBarInactiveTintColor: color.ink2,
        tabBarLabelStyle: { fontSize: 12 },
      }}
    >
      <Tabs.Screen name="trade" options={{ title: t("tabs.trade"), tabBarIcon: tabIcons.trade }} />
      <Tabs.Screen name="payments" options={{ title: t("tabs.payments"), tabBarIcon: tabIcons.payments }} />
      <Tabs.Screen name="history" options={{ title: t("tabs.history"), tabBarIcon: tabIcons.history }} />
      <Tabs.Screen name="account" options={{ title: t("tabs.account"), tabBarIcon: tabIcons.account }} />
    </Tabs>
  );
}
