import type { ReactNode } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { color } from "@/theme/tokens";
import { OFFLINE_BANNER_HEIGHT, useOfflineVisible } from "./OfflineBanner";
export const HEADER_ROW = 62;
export function AppHeader({ children, compact = false, below }: { children: ReactNode; compact?: boolean; below?: ReactNode }) {
  const insets = useSafeAreaInsets();
  const offline = useOfflineVisible();
  return <View style={{ paddingTop: insets.top + (offline ? OFFLINE_BANNER_HEIGHT : 0), backgroundColor: color.ground }}>
    <View style={{ minHeight: HEADER_ROW, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: compact ? 12 : 16 }}>{children}</View>
    {below ? <View style={{ paddingHorizontal: 16, paddingBottom: 6 }}>{below}</View> : null}
  </View>;
}
