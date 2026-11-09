import { useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import type { TradeView } from "@asm/contracts";
import { useSocket } from "@/socket/socket-store";
import { Sheet, type SheetRef } from "@/ui/Sheet";
import { Icon } from "@/ui/Icon";
import { Txt } from "@/theme/ui";
import { color } from "@/theme/tokens";
import type { AppAsset } from "./markets";
import { OpenPositionCard } from "./OpenPositionCard";
import { selectedOpen } from "./selected-open";
const NO_TRADES: readonly TradeView[] = [];
export function PositionStrip({ accountId, accountType, assets, currency, selectedTradeId, onSelect }: {
  accountId: string; accountType: "DEMO" | "LIVE"; assets: readonly AppAsset[]; currency: string;
  listLoaded: boolean; selectedTradeId: string | null; onSelect: (trade: TradeView) => void;
}) {
  const { t } = useTranslation();
  const trades = useSocket(s => s.trades.tradesByAccount[accountId]) ?? NO_TRADES;
  const { open, selected } = useMemo(() => selectedOpen(trades, selectedTradeId), [trades, selectedTradeId]);
  const sheet = useRef<SheetRef>(null);
  const asset = selected ? assets.find(a => a.symbol === selected.symbol) : undefined;
  return <>
    {selected ? <View style={{ paddingHorizontal: 16 }}><OpenPositionCard key={selected.id} compact trade={selected} more={0} name={asset?.displayName ?? selected.symbol} precision={asset?.precision ?? 5} currency={currency} onOpen={() => sheet.current?.present()} trailing={
      <View testID="open-trades-selector" style={{ height: 36, paddingHorizontal: 10, borderRadius: 10, backgroundColor: color.raised, flexDirection: "row", alignItems: "center", gap: 4 }}>
        <Txt size={12} weight={600}>{t("trade.open")} · {open.length}</Txt>
        <View style={{ transform: [{ rotate: "180deg" }] }}><Icon name="chevronDown" size={12} /></View>
      </View>
    } /></View> : null}
    <Sheet ref={sheet} title={`${t("trade.open")} · ${open.length}`} aside={t(accountType === "LIVE" ? "trade.live" : "trade.demo")} scroll snapPoints={["60%", "90%"]}>
      {open.map(trade => { const a = assets.find(x => x.symbol === trade.symbol); return <View key={trade.id} style={{ borderWidth: 1, borderColor: trade.id === selected?.id ? color.accent : "transparent", borderRadius: 12 }}><OpenPositionCard netResult trade={trade} more={0} name={a?.displayName ?? trade.symbol} precision={a?.precision ?? 5} currency={currency} onOpen={() => { onSelect(trade); sheet.current?.dismiss(); }} /></View>; })}
    </Sheet>
  </>;
}
