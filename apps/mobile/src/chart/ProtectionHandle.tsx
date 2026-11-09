import { useMemo, useRef } from "react";
import { PanResponder, View } from "react-native";
import { color } from "@/theme/tokens";
import { Txt } from "@/theme/ui";
import { yForPrice } from "./scale";
import type { PriceRange } from "./types";

/** Keep the drag's starting scale: changing a line must not change its pixels-to-price conversion mid-drag. */
export function ProtectionHandle(props: { label: "SL" | "TP"; price: number; range: PriceRange; height: number; axis: number; precision: number; onPrice: (price: number) => void }) {
  const latest = useRef(props);
  latest.current = props;
  const start = useRef({ price: props.price, perPixel: 0 });
  const move = (dy: number) => {
    const p = latest.current;
    const price = Math.max(10 ** -p.precision, start.current.price - dy * start.current.perPixel);
    p.onPrice(Number(price.toFixed(p.precision)));
  };
  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: () => { const p = latest.current; start.current = { price: p.price, perPixel: (p.range.max - p.range.min) / p.height }; },
    onPanResponderMove: (_, gesture) => move(gesture.dy),
    onPanResponderTerminationRequest: () => false,
  }), []);
  const ink = props.label === "SL" ? color.downText : color.up;
  return <View testID={`chart-${props.label.toLowerCase()}`} accessibilityRole="adjustable" accessibilityLabel={`${props.label} ${props.price.toFixed(props.precision)}`} accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
    onAccessibilityAction={e => props.onPrice(Number((props.price + (e.nativeEvent.actionName === "increment" ? 1 : -1) * 10 ** -props.precision).toFixed(props.precision)))}
    {...responder.panHandlers} style={{ position: "absolute", top: Math.max(0, Math.min(props.height - 44, yForPrice(props.price, props.range, props.height) - 22)), right: props.axis + 8, height: 44, minWidth: 100, justifyContent: "center", alignItems: "center" }}>
    <View style={{ backgroundColor: color.surface, borderWidth: 1, borderColor: ink, borderRadius: 6, padding: 6 }}><Txt size={11} color={ink}>{props.label} ↕ {props.price.toFixed(props.precision)}</Txt></View>
  </View>;
}
