import { useEffect, useRef, useState } from "react";
import { AppState, Pressable, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";
import { CFD_LEVERAGE, cfdSpreadFeeMinor, type Bootstrap } from "@asm/contracts";
import { formatDuration } from "@asm/client-core";
import { api } from "@/api/client";
import { useSessionLive } from "@/auth/use-session-live";
import { useSocket } from "@/socket/socket-store";
import { color, radius } from "@/theme/tokens";
import { Txt } from "@/theme/ui";
import { Money } from "@/ui/Money";
import { Chip } from "@/ui/Chip";
import type { SheetRef } from "@/ui/Sheet";
import { money } from "@/money/format";
import { KeypadSheet } from "@/trade/KeypadSheet";
import { TradeButton } from "@/trade/TradeButton";
import { useTradePrefs, useUserPrefs } from "@/trade/trade-prefs";
import { prefsFor } from "@/trade/prefs-model";
import { stakeAfterKey, stakeAmountOpts, stakeFor, stakeTileLabel, validateStake, withStake } from "@/trade/stake-input";
import type { AppAsset } from "@/trade/markets";
import { useCfdMutation } from "./useCfd";
import { protectionPct } from "./model";
const DURATIONS = [30, 60, 300, 900, 3600];
export function CfdDock({ boot, accountId, asset }: { boot: Bootstrap; accountId: string; asset: AppAsset }) {
  const { t } = useTranslation();
  const live = useSessionLive();
  const account = boot.accounts.find(a => a.id === accountId)!;
  const prefs = useUserPrefs(boot.userId);
  const stake = stakeFor(prefs.stakeByCurrency, account.currency);
  const bal = useSocket(s => s.trades.balances[accountId]) ?? account;
  const check = validateStake(stake, account.currency, bal.realBalance + bal.bonusBalance);
  const fee = cfdSpreadFeeMinor(check.ok ? check.minor : 0, asset.spreadBps ?? 0);
  const [duration, setDuration] = useState(300);
  const [sl, setSl] = useState("");
  const [tp, setTp] = useState("");
  const [stopsOpen, setStopsOpen] = useState(false);
  const slPct = protectionPct(sl, 99.99), tpPct = protectionPct(tp, 1000);
  const [market, setMarket] = useState<{ symbol: string; open: boolean } | null>(null);
  const keypad = useRef<SheetRef>(null);
  const { run, busy } = useCfdMutation(accountId, account.currency);
  useEffect(() => {
    if (!live) return;
    let stopped = false;
    const poll = async () => {
      if (AppState.currentState !== "active") return;
      try {
        const result = await api<{ status: string }>(`/api/cfd/market-status?symbol=${encodeURIComponent(asset.symbol)}`, { timeoutMs: 5000, silentRateLimit: true });
        if (!stopped) setMarket({ symbol: asset.symbol, open: result.status === "open" });
      } catch { if (!stopped) setMarket({ symbol: asset.symbol, open: false }); }
    };
    void poll(); const timer = setInterval(() => void poll(), 5000);
    const sub = AppState.addEventListener("change", state => { if (state === "active") void poll(); else setMarket(null); });
    return () => { stopped = true; clearInterval(timer); sub.remove(); };
  }, [asset.symbol, live]);
  const canTrade = market?.symbol === asset.symbol && market.open;
  const enough = check.ok && check.minor + fee <= bal.realBalance + bal.bonusBalance;
  const disabled = !live || busy || !canTrade || !enough || slPct === null || tpPct === null;
  const latestStakes = () => prefsFor(useTradePrefs.getState().byUser, boot.userId).stakeByCurrency;
  return <View style={{ paddingHorizontal: 14, paddingTop: 10, paddingBottom: 8, gap: 8, borderTopWidth: 1, borderTopColor: color.ruleSoft, backgroundColor: color.dock }}>
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      <Pressable testID="stake-tile" accessibilityRole="button" accessibilityLabel={t("trade.amount")} onPress={() => keypad.current?.present()} style={{ flex: 1, minHeight: 48, paddingHorizontal: 12, borderRadius: radius.md, backgroundColor: color.raised, justifyContent: "center" }}>
        <Txt size={11} color={color.ink2}>{t("trade.amount")}</Txt><Money text={stakeTileLabel(stake, account.currency)} size={20} weight={600} />
      </Pressable>
      <View style={{ flex: 1 }}><Txt size={12}>{t("cfd.leverage", { leverage: CFD_LEVERAGE })}</Txt><Txt size={11} color={color.ink2}>{t("cfd.fee", { amount: money(fee, account.currency) })}</Txt></View>
      <Pressable accessibilityRole="button" accessibilityLabel={t("cfd.protection")} onPress={() => setStopsOpen(v => !v)} style={{ minHeight: 44, padding: 8, justifyContent: "center" }}><Txt size={12}>{t("cfd.protection")} ⌄</Txt></Pressable>
    </View>
    <View style={{ flexDirection: "row", gap: 5 }}>{DURATIONS.map(sec => <Chip key={sec} label={formatDuration(sec)} testID={`expiry-${sec}`} selected={duration === sec} onPress={() => setDuration(sec)} size={12} height={34} style={{ flex: 1, paddingHorizontal: 0 }} />)}</View>
    {stopsOpen ? <View style={{ flexDirection: "row", gap: 8 }}>
      {([{ label: t("cfd.stopLossPct"), value: sl, set: setSl, valid: slPct !== null }, { label: t("cfd.takeProfitPct"), value: tp, set: setTp, valid: tpPct !== null }]).map(item => <View key={item.label} style={{ flex: 1, gap: 3 }}><Txt size={11} color={color.ink2}>{item.label}</Txt><TextInput accessibilityLabel={item.label} keyboardType="decimal-pad" value={item.value} onChangeText={item.set} placeholder={t("cfd.optional")} placeholderTextColor={color.ink3} style={{ color: color.ink, minHeight: 44, borderWidth: 1, borderColor: item.valid ? color.rule : color.downText, borderRadius: radius.sm, paddingHorizontal: 10 }} /></View>)}
    </View> : null}
    <View style={{ flexDirection: "row", gap: 10 }}>{(["LONG", "SHORT"] as const).map(direction => <TradeButton key={direction} direction={direction === "LONG" ? "UP" : "DOWN"} label={t(direction === "LONG" ? "cfd.buy" : "cfd.sell")} sub={null} testID={direction === "LONG" ? "buy" : "sell"} accessibilityLabel={t(direction === "LONG" ? "cfd.buy" : "cfd.sell")} disabled={disabled} busy={busy} onPress={() => void run("/api/cfd/trades", { accountId, symbol: asset.symbol, direction, currency: account.currency, stake: check.ok ? check.minor : 0, durationSec: duration, ...(slPct != null ? { stopLossPct: slPct } : {}), ...(tpPct != null ? { takeProfitPct: tpPct } : {}) })} />)}</View>
    <Txt size={10} color={!enough || !canTrade ? color.downText : color.ink2} style={{ textAlign: "center" }}>{!canTrade ? t("cfd.errors.market_unavailable") : !enough ? t("cfd.errors.insufficient_balance") : t("cfd.risk")}</Txt>
    <KeypadSheet ref={keypad} currency={account.currency} accountType={account.type} payoutPct={null} value={stake} onKey={key => prefs.set({ stakeByCurrency: stakeAfterKey(latestStakes(), account.currency, key, stakeAmountOpts(account.currency)) })} onPreset={text => prefs.set({ stakeByCurrency: withStake(latestStakes(), account.currency, text) })} onDone={() => keypad.current?.dismiss()} />
  </View>;
}
