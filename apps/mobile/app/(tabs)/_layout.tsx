import { Tabs } from "expo-router/js-tabs";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { AppState } from "react-native";
import { queryClient } from "@/api/queries";
import { refreshBootstrap } from "@/api/refresh-bootstrap";
import { useSessionLive } from "@/auth/use-session-live";
import { useLocaleSync } from "@/i18n/use-locale-sync";
import { useLock } from "@/lock/lock-store";
import { useSocket } from "@/socket/socket-store";
import { BottomNav, type BottomTabBarProps } from "@/ui/BottomNav";

const renderTabBar = (props: BottomTabBarProps) => <BottomNav {...props} />;

export default function TabsLayout() {
  const { t } = useTranslation();
  // A deep-link cold start mounts the tabs before the session has hydrated: no socket until there is an
  // unlocked session, or its ticket request goes out without a token. Nor before the lock state is known
  // (`locked` is only a guess until load() settles). Every hook runs on every render; only the values combine.
  const live = useSessionLive();

  // The server's locale (the language of push notifications) follows the app's language, quietly.
  useLocaleSync(live);

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
    <Tabs tabBar={renderTabBar} screenOptions={{ headerShown: false }}>
      <Tabs.Screen name="trade" options={{ title: t("tabs.trade") }} />
      <Tabs.Screen name="payments" options={{ title: t("tabs.payments") }} />
      <Tabs.Screen name="history" options={{ title: t("tabs.history") }} />
      <Tabs.Screen name="account" options={{ title: t("tabs.account") }} />
    </Tabs>
  );
}
