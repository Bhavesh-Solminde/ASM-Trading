import { memo } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View } from "react-native";
import { clockTime } from "@asm/client-core";
import { useSocket } from "@/socket/socket-store";
import { color, radius, space } from "@/theme/tokens";
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

/** "Saved data — updating…" while the chart still shows the resume cache instead of live candles. */
function StaleNote({ hasCache }: { hasCache: boolean }) {
  const { t } = useTranslation();
  const waiting = useSocket((s) => s.chart.candles.length === 0);
  if (!hasCache || !waiting) return null;
  return (
    <Text accessibilityLiveRegion="polite" numberOfLines={1} style={{ color: color.caution, fontSize: 12, flexShrink: 1 }}>
      {t("trade.stale")}
    </Text>
  );
}

export const StatusRow = memo(function StatusRow({
  bonusPct,
  hasCache,
  onBonus,
}: {
  /** Next deposit's bonus percent, or null/0 when there is none to offer. */
  bonusPct: number | null;
  /** The chart is currently painted from the resume cache (until live candles arrive). */
  hasCache: boolean;
  onBonus: () => void;
}) {
  const { t } = useTranslation();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space(2), paddingHorizontal: space(3), height: 44 }}>
      <LiveDot />
      <Clock />
      <StaleNote hasCache={hasCache} />
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
