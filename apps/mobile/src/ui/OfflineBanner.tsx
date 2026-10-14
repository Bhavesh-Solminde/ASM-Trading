import { useNetInfo } from "@react-native-community/netinfo";
import { useTranslation } from "react-i18next";
import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSocket } from "@/socket/socket-store";
import { color, space } from "@/theme/tokens";
import { shouldShowOffline } from "./offline";

/** "No connection" strip under the status bar: shown when NetInfo reports offline or the engine socket has failed twice in a row. */
export function OfflineBanner() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const failures = useSocket((s) => s.consecutiveFailures);
  const { isConnected } = useNetInfo();
  if (!shouldShowOffline(failures, isConnected)) return null;
  return (
    <View
      pointerEvents="none"
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={[styles.strip, { top: insets.top }]}
    >
      <Text style={styles.text}>{t("common.offline")}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  strip: {
    position: "absolute",
    left: 0,
    right: 0,
    minHeight: 28,
    paddingHorizontal: space(4),
    paddingVertical: space(1),
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: color.warnBg,
    borderBottomWidth: 1,
    borderBottomColor: color.down,
  },
  text: { fontSize: 12, color: color.downInk },
});
