import { ActivityIndicator, Pressable, View } from "react-native";
import { useTranslation } from "react-i18next";
import { color, radius } from "@/theme/tokens";
import { Txt } from "@/theme/ui";
import type { useTradeStops } from "./useTradeStops";

type Editor = NonNullable<ReturnType<typeof useTradeStops>>;

export function TradeStopsActions({ stops }: { stops: Editor }) {
  const { t } = useTranslation();
  return (
    <View pointerEvents="box-none" style={{ position: "absolute", top: 54, left: 12, right: 64, gap: 4, alignItems: "flex-start" }}>
      <View style={{ flexDirection: "row", gap: 6 }}>
        <Pressable
          testID={`trade-stops-${stops.mode}`}
          accessibilityRole="button"
          accessibilityState={{ disabled: stops.disabled, busy: stops.busy }}
          disabled={stops.disabled}
          onPress={stops.action}
          style={{ minHeight: 40, paddingHorizontal: 10, flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1,
            borderColor: stops.draft ? color.accentText : color.rule, borderRadius: radius.sm, backgroundColor: color.surface,
            opacity: stops.disabled ? 0.6 : 1 }}
        >
          {stops.busy ? <ActivityIndicator size="small" color={color.ink2} /> : null}
          <Txt size={12} weight={600} color={stops.draft ? color.accentText : color.ink}>{t(`trade.stops.${stops.mode}`)}</Txt>
        </Pressable>
        {stops.draft ? (
          <Pressable
            testID="trade-stops-cancel"
            accessibilityRole="button"
            disabled={stops.busy}
            onPress={stops.cancel}
            style={{ minHeight: 40, paddingHorizontal: 10, justifyContent: "center", borderWidth: 1,
              borderColor: color.rule, borderRadius: radius.sm, backgroundColor: color.surface }}
          >
            <Txt size={12} color={color.ink2}>{t("common.cancel")}</Txt>
          </Pressable>
        ) : null}
      </View>
      {stops.error ? (
        <View accessibilityRole="alert" accessibilityLiveRegion="polite" style={{ backgroundColor: color.surface, padding: 6, borderRadius: radius.sm }}>
          <Txt size={12} color={color.downText}>{stops.error}</Txt>
        </View>
      ) : null}
    </View>
  );
}
