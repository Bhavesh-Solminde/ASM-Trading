import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, View } from "react-native";
import { TIMEFRAMES, type Timeframe } from "@asm/contracts";
import type { ChartType } from "@/chart/types";
import { color, radius, space } from "@/theme/tokens";
import { Chip } from "@/ui/Chip";
import { Icon } from "@/ui/Icon";
import { OVERLAY_ROW_HEIGHT } from "./chart-overlay";

const CHART_TYPES: readonly ChartType[] = ["candles", "line", "area", "bars"];

/**
 * The "⋯" button next to `leading` (the market pill) and `trailing` (the bonus stamp, pushed to the row's right
 * edge). The button opens two compact rows of chips below: chart type and timeframe. `onOpenChange` lets the
 * screen hide the chart readout while the panel is open.
 */
export function ChartTools({
  leading,
  trailing,
  chartType,
  timeframe,
  onChartType,
  onTimeframe,
  onOpenChange,
}: {
  leading: ReactNode;
  trailing?: ReactNode;
  chartType: ChartType;
  timeframe: Timeframe;
  onChartType: (type: ChartType) => void;
  onTimeframe: (timeframe: Timeframe) => void;
  onOpenChange?: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const toggle = () => {
    onOpenChange?.(!open);
    setOpen(!open);
  };
  return (
    <View pointerEvents="box-none" style={{ alignSelf: "stretch", alignItems: "flex-start", gap: space(1) }}>
      <View pointerEvents="box-none" style={{ alignSelf: "stretch", height: OVERLAY_ROW_HEIGHT, flexDirection: "row", alignItems: "center", gap: 8 }}>
        {leading}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("trade.more")}
          accessibilityState={{ expanded: open }}
          onPress={toggle}
          hitSlop={2}
          style={{
            width: 40,
            height: 40,
            borderRadius: 20,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: open ? color.raised : color.overlayPill,
            borderWidth: 1,
            borderColor: open ? color.accentText : color.rule,
          }}
        >
          <Icon name="more" size={18} color={open ? color.ink : color.ink2} />
        </Pressable>
        <View pointerEvents="none" style={{ flex: 1 }} />
        {trailing}
      </View>
      {open ? (
        <View
          style={{
            backgroundColor: color.surface,
            borderRadius: radius.md,
            borderWidth: 1,
            borderColor: color.rule,
            padding: 8,
            gap: 8,
          }}
        >
          <View accessibilityLabel={t("trade.chartType")} style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {CHART_TYPES.map((type) => (
              <Chip key={type} label={t(`trade.${type}`)} height={36} size={13} selected={chartType === type} onPress={() => onChartType(type)} />
            ))}
          </View>
          <View accessibilityLabel={t("trade.timeframe")} style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {TIMEFRAMES.map((tf) => (
              <Chip key={tf} figures label={tf} height={36} size={13} selected={timeframe === tf} onPress={() => onTimeframe(tf)} />
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}
