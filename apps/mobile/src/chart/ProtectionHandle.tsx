import { useMemo, useRef } from "react";
import { PanResponder, Pressable, View } from "react-native";
import { useTranslation } from "react-i18next";
import { color, radius } from "@/theme/tokens";
import { Txt } from "@/theme/ui";
import { Icon } from "@/ui/Icon";
import type { StopSide } from "@/trade/otc-protection";
import type { PriceRange } from "./types";

interface Props {
  side: StopSide;
  price: number;
  y: number;
  range: PriceRange;
  height: number;
  axis: number;
  precision: number;
  busy: boolean;
  onPrice: (price: number) => void;
  onRemove: () => void;
}

/** Keep the starting scale so moving the line never changes the price conversion mid-drag. */
export function ProtectionHandle(props: Props) {
  const { t } = useTranslation();
  const latest = useRef(props);
  latest.current = props;
  const start = useRef({ price: props.price, perPixel: 0 });
  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => !latest.current.busy,
    onMoveShouldSetPanResponder: () => !latest.current.busy,
    onPanResponderGrant: () => {
      const p = latest.current;
      start.current = { price: p.price, perPixel: (p.range.max - p.range.min) / p.height };
    },
    onPanResponderMove: (_, gesture) => {
      const p = latest.current;
      if (!p.busy) p.onPrice(start.current.price - gesture.dy * start.current.perPixel);
    },
    onPanResponderTerminationRequest: () => false,
  }), []);
  const isLoss = props.side === "stopLoss";
  const tag = isLoss ? "sl" : "tp";
  const ink = isLoss ? color.downText : color.up;
  const label = t(isLoss ? "trade.stops.sl" : "trade.stops.tp");
  const priceText = props.price.toFixed(props.precision);
  return (
    <View pointerEvents="box-none" style={{ position: "absolute", top: props.y - 22, right: props.axis + 8,
      height: 44, flexDirection: "row", alignItems: "center" }}>
      <View testID={`chart-${tag}`} accessibilityRole="adjustable" accessibilityLabel={`${label} ${priceText}`}
        accessibilityState={{ disabled: props.busy }}
        accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
        onAccessibilityAction={(e) => {
          if (!props.busy) props.onPrice(props.price + (e.nativeEvent.actionName === "increment" ? 1 : -1) * 10 ** -props.precision);
        }}
        {...responder.panHandlers}
        style={{ height: 44, justifyContent: "center" }}
      >
        <View style={{ backgroundColor: color.surface, borderWidth: 1, borderColor: ink, borderRadius: radius.sm,
          paddingVertical: 4, paddingHorizontal: 6 }}>
          <Txt size={11} color={ink}>{label} ↕ {priceText}</Txt>
        </View>
      </View>
      <Pressable testID={`chart-${tag}-remove`} accessibilityRole="button"
        accessibilityLabel={t(isLoss ? "trade.stops.removeSl" : "trade.stops.removeTp")} disabled={props.busy}
        onPress={props.onRemove} style={{ width: 36, height: 44, alignItems: "center", justifyContent: "center" }}>
        <View style={{ backgroundColor: color.surface, borderRadius: radius.sm, padding: 3 }}>
          <Icon name="close" size={14} color={ink} />
        </View>
      </Pressable>
    </View>
  );
}
