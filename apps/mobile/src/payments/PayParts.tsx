import { useState } from "react";
import { View } from "react-native";
import QRCode from "react-native-qrcode-svg";
import { Circle, Svg } from "react-native-svg";
import { color } from "@/theme/tokens";

/** A 30% arc over a rule-coloured ring: "we are waiting", as on the board. Decorative. */
export function WaitingRing() {
  const r = 9;
  const c = 2 * Math.PI * r;
  return (
    <Svg width={22} height={22} viewBox="0 0 22 22" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      <Circle cx={11} cy={11} r={r} stroke={color.rule} strokeWidth={3} fill="none" />
      <Circle cx={11} cy={11} r={r} stroke={color.accentText} strokeWidth={3} fill="none" strokeLinecap="round" strokeDasharray={`${c * 0.3} ${c}`} rotation={-90} origin="11, 11" />
    </Svg>
  );
}

/** The scannable card: dark modules on `paper`, 196 square with 12 padding. Falls back to nothing if the code cannot be drawn. */
export function QrCard({ value, label }: { value: string; label: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={label} style={{ width: 196, minHeight: 196, padding: 12, borderRadius: 14, backgroundColor: color.paper }}>
      <QRCode value={value} size={172} color={color.ground} backgroundColor={color.paper} quietZone={0} ecl="M" onError={() => setFailed(true)} />
    </View>
  );
}
