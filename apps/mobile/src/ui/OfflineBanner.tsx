import { useNetInfo } from "@react-native-community/netinfo";
import { useTranslation } from "react-i18next";
import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSocket } from "@/socket/socket-store";
import { scriptFor, uiFamily } from "@/theme/font-families";
import { color, space } from "@/theme/tokens";
import { shouldShowOffline } from "./offline";

// Not <Txt>: theme/ui imports this file, so importing Txt here would be a cycle.
/** Height of the strip, so content and toasts can make room for it. */
export const OFFLINE_BANNER_HEIGHT = 28;

/** Whether the "No connection" strip is showing. */
export function useOfflineVisible(): boolean {
  const failures = useSocket((s) => s.consecutiveFailures);
  const { isConnected } = useNetInfo();
  return shouldShowOffline(failures, isConnected);
}

/** "No connection" strip under the status bar: shown when NetInfo reports offline or the engine socket has failed twice in a row. */
export function OfflineBanner() {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  if (!useOfflineVisible()) return null;
  return (
    <View
      pointerEvents="none"
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={[styles.strip, { top: insets.top }]}
    >
      <Text style={[styles.text, { fontFamily: uiFamily(500, scriptFor(i18n.language)) }]}>{t("common.offline")}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  strip: {
    position: "absolute",
    left: 0,
    right: 0,
    height: OFFLINE_BANNER_HEIGHT,
    paddingHorizontal: space(4),
    paddingVertical: space(1),
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: color.warnBg,
    borderBottomWidth: 1,
    borderBottomColor: color.downText,
  },
  text: { fontSize: 12, lineHeight: 16, color: color.ink },
});
