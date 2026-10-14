import { Tabs } from "expo-router/js-tabs";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { AppState } from "react-native";
import { queryClient } from "@/api/queries";
import { refreshBootstrap } from "@/api/refresh-bootstrap";
import { useSession } from "@/auth/session-store";
import { useLock } from "@/lock/lock-store";
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
  // A deep-link cold start mounts the tabs before the session has hydrated: no socket until there is an
  // unlocked session, or its ticket request goes out without a token. Nor before the lock state is known
  // (`locked` is only a guess until load() settles). Every hook runs on every render; only the values combine.
  const sessionLive = useSession((s) => s.ready && s.token !== null);
  const lockLoaded = useLock((s) => s.loaded);
  const locked = useLock((s) => s.locked);
  const live = sessionLive && lockLoaded && !locked;

  // One engine socket for the whole tab shell: open while the app is in the foreground, closed in the background.
  useEffect(() => {
    const { start, stop } = useSocket.getState();
    if (!live) {
      stop();
      return;
    }
    start();
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        // The gatekeeper's foreground handler runs first and may have just relocked.
        if (useLock.getState().locked) return;
        start();
        // Settlements, deposits and withdrawals while backgrounded never reached the (closed) socket.
        refreshBootstrap(queryClient);
      } else if (state === "background") stop();
    });
    return () => {
      sub.remove();
      stop();
    };
  }, [live]);

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
