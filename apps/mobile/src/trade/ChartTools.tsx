import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View } from "react-native";
import { TIMEFRAMES, type Timeframe } from "@asm/contracts";
import type { ChartType } from "@/chart/types";
import { color, radius, space } from "@/theme/tokens";
import { Icon } from "@/ui/Icon";

const CHART_TYPES: readonly ChartType[] = ["candles", "line", "area", "bars"];

function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={{ minHeight: 44, minWidth: 44, justifyContent: "center", alignItems: "center" }}
    >
      <View
        style={{
          paddingHorizontal: space(3),
          paddingVertical: 6,
          borderRadius: radius.pill,
          backgroundColor: selected ? color.brandFill : color.tile,
        }}
      >
        <Text style={{ color: selected ? color.brandInk : color.ink2, fontWeight: "700", fontSize: 13 }}>{label}</Text>
      </View>
    </Pressable>
  );
}

/**
 * The "⋯" button next to `leading` (the market pill); it opens two compact rows of chips below: chart type
 * and timeframe.
 */
export function ChartTools({
  leading,
  chartType,
  timeframe,
  onChartType,
  onTimeframe,
}: {
  leading: ReactNode;
  chartType: ChartType;
  timeframe: Timeframe;
  onChartType: (type: ChartType) => void;
  onTimeframe: (timeframe: Timeframe) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <View pointerEvents="box-none" style={{ alignItems: "flex-start", gap: space(1) }}>
      <View pointerEvents="box-none" style={{ flexDirection: "row", alignItems: "center", gap: space(2) }}>
        {leading}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("trade.more")}
          accessibilityState={{ expanded: open }}
          onPress={() => setOpen((v) => !v)}
          style={{
            width: 44,
            height: 44,
            borderRadius: 22,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: open ? color.brandFill : color.panel,
            borderWidth: 1,
            borderColor: color.rule,
          }}
        >
          <Icon name="more" size={20} color={open ? color.brandInk : color.ink} />
        </Pressable>
      </View>
      {open ? (
        <View
          style={{
            backgroundColor: color.panel,
            borderRadius: radius.md,
            borderWidth: 1,
            borderColor: color.rule,
            paddingHorizontal: space(2),
          }}
        >
          <View accessibilityLabel={t("trade.chartType")} style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center" }}>
            {CHART_TYPES.map((type) => (
              <Chip key={type} label={t(`trade.${type}`)} selected={chartType === type} onPress={() => onChartType(type)} />
            ))}
          </View>
          <View accessibilityLabel={t("trade.timeframe")} style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center" }}>
            {TIMEFRAMES.map((tf) => (
              <Chip key={tf} label={tf} selected={timeframe === tf} onPress={() => onTimeframe(tf)} />
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}
