import { useRef, useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { CfdTradeView } from "@asm/contracts";
import { shortCountdown } from "@asm/client-core";
import { useSocket } from "@/socket/socket-store";
import { color } from "@/theme/tokens";
import { Button, Txt } from "@/theme/ui";
import { Chip } from "@/ui/Chip";
import { Money } from "@/ui/Money";
import { Sheet, type SheetRef } from "@/ui/Sheet";
import { money } from "@/money/format";
import { fmtPrice } from "@/chart/format-price";
import { useNow } from "@/trade/useNow";
import type { AppAsset } from "@/trade/markets";
import { cfdNet, EMPTY_CFD } from "./model";
import { beginProtectionEdit, protectionChanged, protectionPatch } from "./protection-edit";
import { useCfdMutation } from "./useCfd";

function Position({ trade, currency, assets }: { trade: CfdTradeView; currency: string; assets: readonly AppAsset[] }) {
  const { t, i18n } = useTranslation();
  const quote = useSocket(s => s.chart.symbol === trade.symbol && s.phase === "authed" ? s.chart.lastPrice : null);
  const now = useNow(trade.status === "OPEN" ? 1000 : null);
  const net = cfdNet(trade, quote);
  const asset = assets.find(a => a.symbol === trade.symbol);
  const precision = asset?.precision ?? 5;
  const { run, busy } = useCfdMutation(trade.accountId, currency);
  const [edit, setEdit] = useState(false);
  const [draft, setDraft] = useState(() => beginProtectionEdit(trade));
  const patch = protectionPatch(draft, trade);
  const conflict = protectionChanged(draft, trade);
  const beginEdit = () => { setDraft(beginProtectionEdit(trade)); setEdit(true); };
  return <View style={{ marginVertical: 6, padding: 14, gap: 8, backgroundColor: color.raised, borderWidth: 1, borderColor: color.rule, borderRadius: 12 }}>
    <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 10 }}><Txt size={15} weight={600} style={{ flex: 1 }}>{asset?.displayName ?? trade.symbol} · {t(trade.direction === "LONG" ? "cfd.buy" : "cfd.sell")}</Txt><Money text={net === null ? "—" : `${net > 0 ? "+" : ""}${money(net, currency)}`} size={16} color={net !== null && net < 0 ? color.downText : color.up} /></View>
    <Txt size={11} color={color.ink3}>{new Date((trade.closedTs ?? trade.entryTs) * 1000).toLocaleString(i18n.language.startsWith("hi") ? "hi-IN" : "en-IN")}</Txt>
    <Txt size={11} color={color.ink2}>{t("cfd.positionSummary", { amount: money(trade.stake, currency), leverage: trade.leverage ?? 1, entry: fmtPrice(trade.entryPrice, precision) })}</Txt>
    <Txt size={11} color={color.ink2}>{t("cfd.fee", { amount: money(trade.spreadFee ?? 0, currency) })} · {t("cfd.netAfterFee")}</Txt>
    {trade.status === "OPEN" ? <>
      <Txt size={12}>{trade.expiryTs <= now / 1000 ? t("trade.settling") : shortCountdown(Math.ceil(trade.expiryTs - now / 1000))} · SL {trade.stopLoss === null ? "—" : fmtPrice(trade.stopLoss, precision)} · TP {trade.takeProfit === null ? "—" : fmtPrice(trade.takeProfit, precision)}</Txt>
      <Txt size={11} color={color.ink3}>{t("cfd.liquidation", { price: fmtPrice(trade.liqPrice, precision) })}</Txt>
      <View style={{ flexDirection: "row", gap: 8 }}><View style={{ flex: 1 }}><Button label={t("cfd.close")} disabled={busy || trade.expiryTs <= now / 1000} onPress={() => void run(`/api/cfd/trades/${trade.id}/close`)} /></View><View style={{ flex: 1 }}><Button kind="secondary" label={t("cfd.protection")} onPress={() => { if (edit) setEdit(false); else beginEdit(); }} /></View></View>
      {edit ? <><Txt size={11} color={color.ink2}>{t("cfd.absoluteStops")}</Txt><View style={{ flexDirection: "row", gap: 8 }}>{([{ label: "SL", value: draft.stopLossText, set: (text: string) => setDraft(d => ({ ...d, stopLossText: text })) }, { label: "TP", value: draft.takeProfitText, set: (text: string) => setDraft(d => ({ ...d, takeProfitText: text })) }]).map(item => <TextInput key={item.label} accessibilityLabel={item.label} value={item.value} onChangeText={item.set} keyboardType="decimal-pad" placeholder={item.label} placeholderTextColor={color.ink3} style={{ color: color.ink, flex: 1, minHeight: 44, borderWidth: 1, borderColor: color.rule, borderRadius: 8, paddingHorizontal: 10 }} />)}</View>{conflict ? <><Txt accessibilityRole="alert" size={12} color={color.downText}>{t("cfd.protectionChanged")}</Txt><Button kind="secondary" label={t("common.retry")} onPress={beginEdit} /></> : null}<Button kind="secondary" label={t("profile.save")} disabled={!patch || !Object.keys(patch).length || busy} onPress={() => { if (patch && Object.keys(patch).length) void run(`/api/cfd/trades/${trade.id}`, patch, "PATCH").then(ok => { if (ok) setEdit(false); }); }} /></> : null}
      <Txt size={10} color={color.ink3}>{t("cfd.estimate")}</Txt>
    </> : <Txt size={12} color={color.ink2}>{t(`cfd.reason.${trade.closeReason ?? "DURATION"}`)} · {trade.exitPrice === null ? "—" : fmtPrice(trade.exitPrice, precision)}</Txt>}
  </View>;
}
export function CfdPositions({ accountId, currency, assets, compact = false, loaded = true }: { accountId: string; currency: string; assets: readonly AppAsset[]; compact?: boolean; loaded?: boolean }) {
  const { t } = useTranslation();
  const rows = useSocket(s => s.cfd[accountId]) ?? EMPTY_CFD;
  const [tab, setTab] = useState<"OPEN" | "CLOSED">("OPEN");
  const sheet = useRef<SheetRef>(null);
  const open = rows.filter(x => x.status === "OPEN");
  if (compact) return <>
    {loaded && open.length ? <Pressable accessibilityRole="button" accessibilityLabel={t("cfd.positions")} onPress={() => sheet.current?.present()} style={{ marginHorizontal: 14, padding: 10, borderRadius: 10, backgroundColor: color.dock, borderWidth: 1, borderColor: color.rule }}><Txt size={13}>{t("cfd.openCount", { count: open.length })} · {t("cfd.manage")}</Txt></Pressable> : null}
    <Sheet ref={sheet} title={t("cfd.positions")} scroll snapPoints={["65%", "90%"]}><CfdPositions accountId={accountId} currency={currency} assets={assets} loaded={loaded} /></Sheet>
  </>;
  return <View style={{ paddingHorizontal: 14, gap: 8 }}>
    <View style={{ flexDirection: "row", gap: 8 }}><Chip label={t("trade.open")} count={open.length} selected={tab === "OPEN"} onPress={() => setTab("OPEN")} /><Chip label={t("trade.closed")} count={rows.length - open.length} selected={tab === "CLOSED"} onPress={() => setTab("CLOSED")} /></View>
    {!loaded ? <Txt color={color.ink2}>{t("common.loading")}</Txt> : null}
    {(loaded ? rows : []).filter(x => x.status === tab).map(trade => <Position key={trade.id} trade={trade} currency={currency} assets={assets} />)}
    {loaded && !rows.some(x => x.status === tab) ? <Txt color={color.ink2}>{t("trade.noTrades")}</Txt> : null}
  </View>;
}
