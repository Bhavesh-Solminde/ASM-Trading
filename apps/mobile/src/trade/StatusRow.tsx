import { memo } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, View } from "react-native";
import { clockTime } from "@asm/client-core";
import type { Timeframe } from "@asm/contracts";
import type { ResumeSnapshot } from "@/cache/codec";
import { useSocket } from "@/socket/socket-store";
import { color } from "@/theme/tokens";
import { Txt } from "@/theme/ui";
import { Stamp } from "@/ui/Stamp";
import { chartSource } from "./chart-source";
import { useNow } from "./useNow";

/** Green while the engine socket is authenticated, red otherwise. Re-renders only when that flips. */
function LiveDot() {
  const live = useSocket((s) => s.phase === "authed");
  return <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: live ? color.up : color.downText }} />;
}

/** The only part of the line that re-renders each second. */
function Clock() {
  const now = useNow();
  return (
    <Txt font="fig" size={11} color={color.ink3}>
      {clockTime(Math.floor(now / 1000))}
    </Txt>
  );
}

/** "Saved data — updating…" only while the candles on screen really are the resume snapshot's. */
function StaleNote({ snapshot, symbol, timeframe }: { snapshot: ResumeSnapshot | null; symbol: string | null; timeframe: Timeframe }) {
  const { t } = useTranslation();
  const showing = useSocket((s) => symbol !== null && chartSource({ symbol, timeframe, chart: s.chart, snapshot }) === "snapshot");
  if (!showing) return null;
  return (
    <Txt accessibilityLiveRegion="polite" numberOfLines={1} size={11} color={color.gold} style={{ flexShrink: 1 }}>
      {t("trade.stale")}
    </Txt>
  );
}

/** Quiet status line at the chart's bottom-left: connection dot, clock, stale-data note. */
export const StatusLine = memo(function StatusLine({
  snapshot,
  symbol,
  timeframe,
}: {
  /** The resume snapshot, or null once live candles have arrived (it is then never shown again). */
  snapshot: ResumeSnapshot | null;
  symbol: string | null;
  timeframe: Timeframe;
}) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
      <LiveDot />
      <Clock />
      <StaleNote snapshot={snapshot} symbol={symbol} timeframe={timeframe} />
    </View>
  );
});

/** Gold "+100% BONUS" stamp in the chart's overlay row; opens the bonus sheet. Bonus appears on /trade only. */
export function BonusStamp({ pct, onPress }: { pct: number; onPress: () => void }) {
  const { t } = useTranslation();
  const label = t("trade.bonus", { pct });
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={{ top: 12, bottom: 12, left: 6, right: 6 }}>
      <Stamp label={label} tone="gold" size="md" />
    </Pressable>
  );
}
