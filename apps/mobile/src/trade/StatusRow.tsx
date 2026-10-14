import { memo } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View } from "react-native";
import { clockTime } from "@asm/client-core";
import type { Timeframe } from "@asm/contracts";
import type { ResumeSnapshot } from "@/cache/codec";
import { useSocket } from "@/socket/socket-store";
import { color, radius, space } from "@/theme/tokens";
import { chartSource } from "./chart-source";
import { useNow } from "./useNow";

/** Green while the engine socket is authenticated, red otherwise. Re-renders only when that flips. */
function LiveDot() {
  const live = useSocket((s) => s.phase === "authed");
  return <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: live ? color.up : color.down }} />;
}

/** The only part of the row that re-renders each second. */
function Clock() {
  const now = useNow();
  return (
    <Text style={{ color: color.ink2, fontSize: 12, fontVariant: ["tabular-nums"] }}>{clockTime(Math.floor(now / 1000))}</Text>
  );
}

/** "Saved data — updating…" only while the candles on screen really are the resume snapshot's. */
function StaleNote({ snapshot, symbol, timeframe }: { snapshot: ResumeSnapshot | null; symbol: string | null; timeframe: Timeframe }) {
  const { t } = useTranslation();
  const showing = useSocket((s) => symbol !== null && chartSource({ symbol, timeframe, chart: s.chart, snapshot }) === "snapshot");
  if (!showing) return null;
  return (
    <Text accessibilityLiveRegion="polite" numberOfLines={1} style={{ color: color.caution, fontSize: 12, flexShrink: 1 }}>
      {t("trade.stale")}
    </Text>
  );
}

export const StatusRow = memo(function StatusRow({
  bonusPct,
  snapshot,
  symbol,
  timeframe,
  onBonus,
}: {
  /** Next deposit's bonus percent, or null/0 when there is none to offer. */
  bonusPct: number | null;
  /** The resume snapshot, or null once live candles have arrived (it is then never shown again). */
  snapshot: ResumeSnapshot | null;
  symbol: string | null;
  timeframe: Timeframe;
  onBonus: () => void;
}) {
  const { t } = useTranslation();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space(2), paddingHorizontal: space(3), height: 44 }}>
      <LiveDot />
      <Clock />
      <StaleNote snapshot={snapshot} symbol={symbol} timeframe={timeframe} />
      <View style={{ flex: 1 }} />
      {bonusPct ? (
        <Pressable
          accessibilityRole="button"
          onPress={onBonus}
          style={{ minHeight: 44, minWidth: 44, justifyContent: "center", alignItems: "center" }}
        >
          <View style={{ backgroundColor: color.brandDim, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4 }}>
            <Text style={{ color: color.brand, fontSize: 12, fontWeight: "700" }}>{t("trade.bonus", { pct: bonusPct })}</Text>
          </View>
        </Pressable>
      ) : null}
    </View>
  );
});
