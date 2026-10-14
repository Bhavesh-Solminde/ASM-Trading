import { useState, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Defs, Ellipse, LinearGradient, RadialGradient, Rect, Stop, Svg } from "react-native-svg";
import { color } from "@/theme/tokens";
import { OFFLINE_BANNER_HEIGHT, useOfflineVisible } from "./OfflineBanner";
import { Tricolour } from "./Tricolour";

/** Content row height; with the 2pt tricolour the header is 51pt under the status bar (canvas: height 51). */
export const HEADER_ROW = 49;

/**
 * The tab screens' header: navy gradient running under the status bar, a soft saffron glow top-right, one 49pt
 * row of content and the tricolour hairline. The status-bar inset is the device's real one (safe area), not the
 * canvas's 28. Static (no animation) so it never costs the chart frames.
 */
export function AppHeader({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const offline = useOfflineVisible();
  const [width, setWidth] = useState(0);
  return (
    <View
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      style={{ paddingTop: insets.top + (offline ? OFFLINE_BANNER_HEIGHT : 0), overflow: "hidden" }}
    >
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <Svg width="100%" height="100%">
          <Defs>
            <LinearGradient id="ixtHeader" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={color.headerTop} />
              <Stop offset="1" stopColor={color.headerBottom} />
            </LinearGradient>
            <RadialGradient id="ixtGlow" cx="50%" cy="50%" r="50%">
              <Stop offset="0" stopColor={color.saffron} stopOpacity={0.18} />
              <Stop offset="0.7" stopColor={color.saffron} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" fill="url(#ixtHeader)" />
          {/* Canvas: a 160x140 glow at right -40, top -60 of the header box. */}
          {width > 0 ? <Ellipse cx={width - 40} cy={10} rx={80} ry={70} fill="url(#ixtGlow)" /> : null}
        </Svg>
      </View>
      <View style={{ height: HEADER_ROW, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12 }}>{children}</View>
      <Tricolour />
    </View>
  );
}
