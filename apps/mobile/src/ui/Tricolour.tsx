import { View, type StyleProp, type ViewStyle } from "react-native";
import { Defs, LinearGradient, Rect, Stop, Svg } from "react-native-svg";
import { color } from "@/theme/tokens";

/**
 * The logo's tricolour as a 2pt rule. Plain = three equal bands (header). `fade` = the login rule that fades in
 * from transparent at both ends.
 */
export function Tricolour({ fade = false, width, style }: { fade?: boolean; width?: number; style?: StyleProp<ViewStyle> }) {
  if (!fade) {
    return (
      <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden style={[{ height: 2, width, flexDirection: "row" }, style]}>
        <View style={{ flex: 1, backgroundColor: color.saffron }} />
        <View style={{ flex: 1, backgroundColor: color.tricolourWhite }} />
        <View style={{ flex: 1, backgroundColor: color.indiaGreen }} />
      </View>
    );
  }
  return (
    <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden style={[{ height: 2, width }, style]}>
      <Svg width="100%" height={2}>
        <Defs>
          <LinearGradient id="ixtTricolourFade" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor={color.saffron} stopOpacity={0} />
            <Stop offset="0.18" stopColor={color.saffron} />
            <Stop offset="0.333" stopColor={color.saffron} />
            <Stop offset="0.333" stopColor={color.tricolourWhite} />
            <Stop offset="0.666" stopColor={color.tricolourWhite} />
            <Stop offset="0.666" stopColor={color.indiaGreen} />
            <Stop offset="0.82" stopColor={color.indiaGreen} />
            <Stop offset="1" stopColor={color.indiaGreen} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="2" fill="url(#ixtTricolourFade)" />
      </Svg>
    </View>
  );
}
