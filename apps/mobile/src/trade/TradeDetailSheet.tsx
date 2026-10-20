import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import type { TradeView } from "@asm/contracts";
import { Sheet, type SheetRef } from "@/ui/Sheet";
import { Button, Txt } from "@/theme/ui";
import { color } from "@/theme/tokens";
import { money } from "@/money/format";
import { useSocket } from "@/socket/socket-store";
import { fmtPrice } from "@/chart/format-price";
import { OpenPositionCard } from "./OpenPositionCard";
import type { AppAsset } from "./markets";
export const TradeDetailSheet = forwardRef<SheetRef, { trade: TradeView | null; accountId?: string; accountType?: "LIVE" | "DEMO"; assets: readonly AppAsset[]; currency: string }>(function TradeDetailSheet({ trade, accountId, accountType, assets, currency }, ref) {
  const { t } = useTranslation();
  const inner = useRef<SheetRef>(null);
  // Freeze selection on opening; settlement must not silently switch the sheet to the next trade.
  const [selected, setSelected] = useState<TradeView | null>(null);
  const latest = useSocket(s => selected ? Object.values(s.trades.tradesByAccount).flat().find(x => x.id === selected.id) : undefined);
  useImperativeHandle(ref, () => ({ present: () => { setSelected(trade); inner.current?.present(); }, dismiss: () => inner.current?.dismiss() }), [trade]);
  const shown = latest ?? selected ?? trade;
  const asset = assets.find(a => a.symbol === shown?.symbol);
  return <Sheet ref={inner} title={t("redesign.tradeDetails")} aside={accountType ? t(accountType === "LIVE" ? "trade.liveAccount" : "trade.demoAccount") : undefined}>
    {shown ? <>
      <Txt weight={600} size={20}>{asset?.displayName ?? shown.symbol}</Txt>
      {shown.status === "OPEN" ? <OpenPositionCard trade={shown} more={0} name={asset?.displayName ?? shown.symbol} precision={asset?.precision ?? 5} currency={currency} onOpen={() => {}} /> : <Txt>{t(`trade.${shown.status === "WON" ? "statusWon" : shown.status === "LOST" ? "statusLost" : "statusRefund"}`)}</Txt>}
      <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 12 }}><Txt color={color.ink2}>{t("trade.amount")}</Txt><Txt weight={600}>{money(shown.stake, currency)}</Txt></View>
      <View style={{ flexDirection: "row", justifyContent: "space-between", paddingBottom: 12 }}><Txt color={color.ink2}>{t("redesign.entryPrice")}</Txt><Txt>{fmtPrice(shown.entryPrice, asset?.precision ?? 5)}</Txt></View>
      <Button label={t("redesign.backToChart")} onPress={() => inner.current?.dismiss()} kind="light" />
    </> : null}
  </Sheet>;
});
