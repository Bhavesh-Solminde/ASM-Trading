import { useRef } from "react";
import { Pressable, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { Timeframe } from "@asm/contracts";
import { color } from "@/theme/tokens";
import { Txt } from "@/theme/ui";
import { Icon } from "@/ui/Icon";
import type { SheetRef } from "@/ui/Sheet";
import { useSocket } from "@/socket/socket-store";
import { useFullscreen } from "./fullscreen-store";
import { TradesSheet } from "./TradesSheet";
import type { AppAsset } from "./markets";
export function ChartToolbar({ timeframe, onTimeframe, accountId, accountType, assets, currency, listLoaded }: {
  timeframe: Timeframe; onTimeframe: (tf: Timeframe) => void; accountId: string; accountType: "DEMO" | "LIVE";
  assets: readonly AppAsset[]; currency: string; listLoaded: boolean;
}) {
  const { t } = useTranslation();
  const fullscreen = useFullscreen(s => s.active);
  const count = useSocket(s => s.trades.tradesByAccount[accountId]?.filter(x => x.status === "OPEN").length ?? 0);
  const sheet = useRef<SheetRef>(null);
  return <View style={{ minHeight: 44, flexDirection: "row", alignItems: "center", paddingHorizontal: 8 }}>
    {(["1m", "5m", "15m"] as const).map(tf => <Pressable key={tf} accessibilityRole="button" accessibilityState={{ selected: timeframe === tf }} onPress={() => onTimeframe(tf)} style={{ minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" }}><Txt size={12} weight={600} color={timeframe === tf ? color.accentText : color.ink3}>{tf}</Txt></Pressable>)}
    <View style={{ flex: 1 }} />
    <Pressable accessibilityRole="button" onPress={() => sheet.current?.present()} style={{ minHeight: 44, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 8 }}>
      <Icon name="history" size={16} color={color.ink2} /><Txt size={12}>{t("tabs.history")}{count ? ` · ${count}` : ""}</Txt>
    </Pressable>
    <Pressable testID="chart-fullscreen" accessibilityRole="button" accessibilityLabel={t(fullscreen ? "redesign.exitFullscreen" : "redesign.fullscreen")} accessibilityState={{ expanded: fullscreen }} onPress={() => useFullscreen.getState().set(!fullscreen)} style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}><Icon name={fullscreen ? "collapse" : "expand"} size={20} color={color.ink2} /></Pressable>
    <TradesSheet ref={sheet} accountId={accountId} accountType={accountType} assets={assets} currency={currency} listLoaded={listLoaded} />
  </View>;
}
