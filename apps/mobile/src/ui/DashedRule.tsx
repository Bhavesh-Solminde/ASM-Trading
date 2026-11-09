import { Line, Svg } from "react-native-svg";
import { color as palette } from "@/theme/tokens";

/** A 1pt dashed rule. RN draws a one-sided dashed border solid on Android, so this is an SVG line. */
export function DashedRule({ color = palette.rule }: { color?: string }) {
  return (
    <Svg width="100%" height={1} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      <Line x1="0" y1="0.5" x2="100%" y2="0.5" stroke={color} strokeWidth={1} strokeDasharray="4 3" />
    </Svg>
  );
}
