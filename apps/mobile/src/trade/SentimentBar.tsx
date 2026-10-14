import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { useSocket } from "@/socket/socket-store";
import { color } from "@/theme/tokens";
import { sentimentSplit } from "./markets";

/**
 * Stake-weighted up/down split for the open market: a thin bar down the chart's left edge, green share
 * rising from the bottom (the web phone layout). Labels live in the accessibility label.
 */
export function SentimentBar() {
  const { t } = useTranslation();
  const { upPct, downPct } = sentimentSplit(useSocket((s) => s.chart.sentiment));
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={t("trade.sentiment", { up: Math.round(upPct), down: Math.round(downPct) })}
      pointerEvents="none"
      style={{
        position: "absolute",
        left: 6,
        top: 72,
        bottom: 72,
        width: 3,
        borderRadius: 2,
        overflow: "hidden",
        backgroundColor: color.down,
      }}
    >
      <View style={{ marginTop: "auto", height: `${upPct}%`, backgroundColor: color.up }} />
    </View>
  );
}
