import { Canvas, Group, Image as SkImage, LinearGradient, Rect, rect, rrect, useImage, vec } from "@shopify/react-native-skia";
import { memo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import bearArt from "../../assets/art/bear-r1.webp";
import bullArt from "../../assets/art/bull-b3.webp";
import { color, gradient, radius } from "@/theme/tokens";
import { Txt } from "@/theme/ui";
import { FigText } from "@/ui/FigText";
import { cssGradientPoints } from "@/ui/gradient";
import { Icon } from "@/ui/Icon";
import { BEAST_OPACITY, BUTTON_H, bearFrame, bullFrame } from "./beast-frame";

/**
 * Up/Down button. RN 0.86 has `mixBlendMode` (new arch), but Android only applies it from API 29 and minSdk is 26.
 * Skia gives the same overlay on every device: the gradient and the engraved art share one canvas and the art is
 * drawn with blendMode "overlay" (the same W3C formula the design canvas used). Text and arrow are RN on top.
 * Until the art decodes the plain gradient shows.
 */
export const TradeButton = memo(function TradeButton({
  direction,
  label,
  sub,
  disabled,
  busy,
  onPress,
  testID,
  accessibilityLabel,
}: {
  direction: "UP" | "DOWN";
  label: string;
  /** "win ₹1,930", or null while the amount is invalid / payout unknown. */
  sub: string | null;
  disabled: boolean;
  busy: boolean;
  onPress: () => void;
  testID: string;
  accessibilityLabel: string;
}) {
  const up = direction === "UP";
  const [w, setW] = useState(0);
  // Both hooks run every render (rules-of-hooks); only one image is drawn.
  const bull = useImage(bullArt);
  const bear = useImage(bearArt);
  const art = up ? bull : bear;
  const g = up ? gradient.up : gradient.down;
  const p = cssGradientPoints(135, w, BUTTON_H);
  const frame = up ? bullFrame(w) : bearFrame(w);
  const ink = up ? color.upInk : color.downInk;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled, busy }}
      disabled={disabled}
      onPress={onPress}
      onLayout={(e) => setW(e.nativeEvent.layout.width)}
      style={({ pressed }) => ({
        flex: 1,
        height: BUTTON_H,
        borderRadius: radius.md,
        overflow: "hidden",
        justifyContent: "center",
        gap: 1,
        paddingLeft: 16,
        paddingRight: up ? 30 : 16,
        opacity: disabled ? 0.5 : pressed ? 0.85 : 1,
      })}
    >
      {w > 0 ? (
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          <Canvas style={{ flex: 1 }}>
            <Group clip={rrect(rect(0, 0, w, BUTTON_H), radius.md, radius.md)}>
              <Rect x={0} y={0} width={w} height={BUTTON_H}>
                <LinearGradient start={vec(p.start.x, p.start.y)} end={vec(p.end.x, p.end.y)} colors={[...g.colors]} positions={[...g.positions]} />
              </Rect>
              {art ? (
                <SkImage image={art} x={frame.x} y={frame.y} width={frame.w} height={frame.h} fit="fill" blendMode="overlay" opacity={BEAST_OPACITY} />
              ) : null}
              <Rect x={0} y={0} width={w} height={1} color={g.highlight} />
            </Group>
          </Canvas>
        </View>
      ) : null}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Icon name={up ? "arrowUp" : "arrowDown"} size={18} strokeWidth={2.25} color={ink} />
        <Txt weight={600} size={20} lineHeight={24} color={ink}>
          {label}
        </Txt>
        {busy ? <ActivityIndicator size="small" color={ink} /> : null}
      </View>
      {sub ? <FigText text={sub} weight={500} size={12} tracking={-0.02} lineHeight={15} color={ink} /> : null}
    </Pressable>
  );
});
