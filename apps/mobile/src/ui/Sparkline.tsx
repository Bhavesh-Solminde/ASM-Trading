import { useState } from "react";
import { View } from "react-native";
import { Circle, Defs, LinearGradient, Path, Stop, Svg } from "react-native-svg";
import { color } from "@/theme/tokens";
import { sparkline } from "./sparkline-path";

/** The login screen's market line. Decorative: no price, no market name (no real quote is available signed out). */
export function Sparkline({ seed = 7, height = 128 }: { seed?: number; height?: number }) {
  const [width, setWidth] = useState(0);
  const s = width > 0 ? sparkline(seed, width - 4, height, 70) : null;
  return (
    <View
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={{ height }}
    >
      {s ? (
        <Svg width={width} height={height}>
          <Defs>
            <LinearGradient id="ixtLoginArea" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={color.up} stopOpacity={0.28} />
              <Stop offset="1" stopColor={color.up} stopOpacity={0} />
            </LinearGradient>
          </Defs>
          <Path d={s.fill} fill="url(#ixtLoginArea)" />
          <Path d={s.line} fill="none" stroke={color.up} strokeWidth={1.8} strokeLinejoin="round" />
          <Circle cx={s.lastX} cy={s.lastY} r={3.5} fill={color.up} />
        </Svg>
      ) : null}
    </View>
  );
}
