import { useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, View } from "react-native";
import { TIMEFRAMES, type Timeframe } from "@asm/contracts";
import type { ChartType } from "@/chart/types";
import { color } from "@/theme/tokens";
import { Chip } from "@/ui/Chip";
import { Icon } from "@/ui/Icon";
import { Sheet, type SheetRef } from "@/ui/Sheet";
const CHART_TYPES: readonly ChartType[] = ["candles", "line", "area", "bars"];
export function ChartTools({ leading, chartType, timeframe, onChartType, onTimeframe }: {
  leading: ReactNode; trailing?: ReactNode; chartType: ChartType; timeframe: Timeframe;
  onChartType: (type: ChartType) => void; onTimeframe: (timeframe: Timeframe) => void; onOpenChange?: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const sheet = useRef<SheetRef>(null);
  return <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 12, minHeight: 48, gap: 8 }}>
    {leading}
    <Pressable accessibilityRole="button" accessibilityLabel={t("trade.chartType")} onPress={() => sheet.current?.present()} style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}>
      <Icon name="trade" size={22} color={color.ink2} />
    </Pressable>
    <Sheet ref={sheet} title={t("trade.chartType")}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{CHART_TYPES.map(type => <Chip key={type} label={t(`trade.${type}`)} height={44} selected={chartType === type} onPress={() => onChartType(type)} />)}</View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{TIMEFRAMES.map(tf => <Chip key={tf} label={tf} height={44} selected={timeframe === tf} onPress={() => onTimeframe(tf)} />)}</View>
    </Sheet>
  </View>;
}
