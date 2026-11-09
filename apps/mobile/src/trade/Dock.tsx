import { useProtection } from "./protection-store";
import { EMPTY_PROTECTION, initialProtection } from "./otc-protection";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Switch, View } from "react-native";
import { formatDuration, grossReturnMinor, profitForStake } from "@asm/client-core";
import { money } from "@/money/format";
import { TRADE_DURATIONS_SEC } from "@asm/contracts";
import { Icon } from "@/ui/Icon";
import { minStakeMinor, stakeToMinor } from "@asm/client-core";
import type { Bootstrap } from "@asm/contracts";
import { useSocket } from "@/socket/socket-store";
import { color, radius } from "@/theme/tokens";
import { Txt } from "@/theme/ui";
import { Money } from "@/ui/Money";
import { Sheet, type SheetRef } from "@/ui/Sheet";
import { ExpirySheet } from "./ExpirySheet";
import { KeypadSheet } from "./KeypadSheet";
import { payoutPctFor, type AppAsset } from "./markets";
import { prefsFor } from "./prefs-model";
import { stakeProblemText } from "./stake-problem";
import { MAX_STAKE_MINOR, resolveExpiry, stakeAfterKey, stakeAmountOpts, stakeFor, stakeTileLabel, validateStake, withStake } from "./stake-input";
import { TradeButton } from "./TradeButton";
import { useTradePrefs, useUserPrefs } from "./trade-prefs";
import { useTradeSubmit } from "./useTradeSubmit";

/**
 * Amount, trade length and Up/Down. The bottom nav below already adds the bottom safe-area inset, so the dock has
 * none. Expiry and the stake (kept separately for each currency) are saved per user. The stake is checked against
 * the account's real + bonus balance, as the server does, and keypad presses are applied to the latest saved stake.
 */
export function Dock({ boot, accountId, asset }: { boot: Bootstrap; accountId: string; asset: AppAsset }) {
  const { t } = useTranslation();
  const protectionKey = `${accountId}:${asset.symbol}`;
  const protection = useProtection(s => s.key === protectionKey ? s.draft : EMPTY_PROTECTION);
  const quoteReady = useSocket(s => s.phase === "authed" && s.chart.symbol === asset.symbol && !!s.chart.displayQuote);
  const prefs = useUserPrefs(boot.userId);
  const account = boot.accounts.find((a) => a.id === accountId);
  const bal = useSocket((s) => s.trades.balances[accountId]) ?? account;
  const livePayout = useSocket((s) => (s.chart.symbol === asset.symbol ? s.chart.payoutPct : null));
  const payoutPct = payoutPctFor(asset, livePayout);

  const currency = account?.currency ?? "USD";
  const expirySec = resolveExpiry(prefs.expirySec);
  // Each currency keeps its own stake, so switching DEMO <-> LIVE never reads ₹5,000 as $5,000.
  const stake = stakeFor(prefs.stakeByCurrency, currency);

  const { set } = prefs;
  // Keypad presses build on the saved stakes as they are NOW, not the copy this render closed over.
  const latestStakes = () => prefsFor(useTradePrefs.getState().byUser, boot.userId).stakeByCurrency;

  const available = bal ? bal.realBalance + bal.bonusBalance : 0;
  const check = validateStake(stake, currency, available);
  const { submit, busy, pending, retry } = useTradeSubmit({ accountId, symbol: asset.symbol, stakeMinor: check.ok ? check.minor : null, durationSec: expirySec, currency });
  const keypad = useRef<SheetRef>(null);
  const expiry = useRef<SheetRef>(null);
  const protectionInfo = useRef<SheetRef>(null);

  if (!account) return null;
  const profit = check.ok ? profitForStake(check.minor, payoutPct) : null;
  const blocked = !check.ok || busy || !quoteReady || boot.tradingModel !== "OTC_FIXED";

  const problem = stakeProblemText(check, currency, t);

  const stakeLabel = stakeTileLabel(stake, currency);


  return (
    <View style={{ paddingHorizontal: 16, gap: 4, backgroundColor: color.surface }}>
      <View style={{ flexDirection: "row", gap: 8 }}>
        {(["amount", "duration"] as const).map(kind => <View key={kind} style={{ flex: 1, height: 44, borderRadius: 12, backgroundColor: color.raised, flexDirection: "row", alignItems: "center" }}>
          {[-1, 0, 1].map(step => <Pressable key={step} testID={step === 0 ? kind === "amount" ? "stake-tile" : "expiry-tile" : `${kind}-${step < 0 ? "decrease" : "increase"}`} accessibilityRole="button" accessibilityLabel={`${step < 0 ? "Decrease" : step > 0 ? "Increase" : "Choose"} ${kind}`} onPress={() => {
            if (!step) { if (kind === "amount") keypad.current?.present(); else expiry.current?.present(); return; }
            if (kind === "amount") {
              const current = stakeToMinor(stakeFor(latestStakes(), currency));
              const next = Math.min(MAX_STAKE_MINOR, Math.max(minStakeMinor(currency), (Number.isSafeInteger(current) ? current : minStakeMinor(currency)) + step * minStakeMinor(currency)));
              set({ stakeByCurrency: withStake(latestStakes(), currency, (next / 100).toFixed(currency === "INR" ? 0 : 2)) });
            } else {
              const durations: readonly number[] = TRADE_DURATIONS_SEC;
              const index = durations.indexOf(resolveExpiry(prefsFor(useTradePrefs.getState().byUser, boot.userId).expirySec));
              set({ expirySec: durations[Math.max(0, Math.min(durations.length - 1, index + step))] });
            }
          }} style={{ height: 44, flex: step === 0 ? 1 : undefined, width: step === 0 ? undefined : 28, justifyContent: "center", alignItems: "center" }}>
            {step ? <Txt color={color.ink2} size={18}>{step < 0 ? "−" : "+"}</Txt> : <>
              <Txt size={10} color={kind === "amount" && problem ? color.downText : color.ink2} numberOfLines={1}>{kind === "amount" ? problem || t("trade.amount") : t("redesign.duration")}</Txt>
              <Money text={kind === "amount" ? stakeLabel : formatDuration(expirySec)} size={17} weight={600} numberOfLines={1} adjustsFontSizeToFit />
            </>}
          </Pressable>)}
        </View>)}
      </View>
      <View style={{ height: 28, flexDirection: "row", alignItems: "center", gap: 4 }}>
        <Txt size={12} color={color.ink2}>SL / TP</Txt>
        <Switch testID="protection-toggle" accessibilityLabel="SL / TP" value={protection.enabled} style={{ transform: [{ scale: 0.65 }], marginHorizontal: -8 }} onValueChange={() => {
          const price = useSocket.getState().chart.displayQuote?.price;
          if (protection.enabled) useProtection.getState().set(protectionKey, EMPTY_PROTECTION);
          else if (price) useProtection.getState().set(protectionKey, initialProtection(price, asset.precision, protection.direction));
        }} />
        <Pressable hitSlop={8} accessibilityRole="button" accessibilityLabel="SL / TP information" onPress={() => protectionInfo.current?.present()} style={{ padding: 4 }}><Txt size={13} color={color.ink2}>ⓘ</Txt></Pressable>
        {protection.enabled ? (["UP", "DOWN"] as const).map(direction => <Pressable key={direction} accessibilityRole="button" accessibilityState={{ selected: direction === protection.direction }} onPress={() => {
          const price = useSocket.getState().chart.displayQuote?.price;
          if (price) useProtection.getState().set(protectionKey, initialProtection(price, asset.precision, direction));
        }} style={{ padding: 4 }}><Icon name={direction === "UP" ? "arrowUp" : "arrowDown"} size={16} color={direction === protection.direction ? color.ink : color.ink3} /></Pressable>) : null}
        <Txt size={11} color={color.ink2} numberOfLines={1} style={{ flex: 1, textAlign: "right" }}>{payoutPct ?? "—"}% · {t("redesign.potentialProfit")}: {profit === null ? "—" : money(profit, currency, { trim: true })}</Txt>
      </View>
      {pending && !busy ? <Pressable testID="retry-previous-trade" accessibilityRole="button" onPress={() => void retry()} style={{ minHeight: 52, padding: 12, backgroundColor: color.raised, borderRadius: radius.md, borderWidth: 1, borderColor: color.gold }}>
        <Txt size={12}>{t("trade.retryNamed", { direction: pending.body.direction, symbol: pending.body.symbol, amount: money(pending.body.stake, pending.body.currency ?? currency), price: pending.displayedPrice ?? "—" })}</Txt>
      </Pressable> : <View style={{ flexDirection: "row", gap: 10 }}>
        {(["UP", "DOWN"] as const).map((dir) => {
          const up = dir === "UP";
          const label = up ? t("trade.up") : t("trade.down");
          const payoutText = payoutPct !== null ? t("trade.payout", { pct: payoutPct }) : "";
          // What comes back on a win: the stake plus the profit (the canvas shows "win ₹1,930" for ₹1,000 at 93%).
          const win = check.ok && profit !== null ? t("trade.win", { amount: money(grossReturnMinor(check.minor, profit), currency, { trim: true }) }) : null;
          return (
            <TradeButton
              key={dir}
              direction={dir}
              testID={up ? "buy" : "sell"}
              label={label}
              sub={win}
              accessibilityLabel={[label, payoutText, win ?? ""].filter(Boolean).join(", ")}
              disabled={blocked}
              busy={busy}
              onPress={() => void submit(dir)}
            />
          );
        })}
      </View>}

      <Sheet ref={protectionInfo} title="SL / TP">
        <Txt>{t("trade.dragProtection")}</Txt>
        <Txt color={color.ink2}>{t("trade.fixedPayout")}</Txt>
      </Sheet>
      <KeypadSheet
        ref={keypad}
        currency={currency}
        accountType={account.type}
        payoutPct={payoutPct}
        value={stake}
        onKey={(key) => set({ stakeByCurrency: stakeAfterKey(latestStakes(), currency, key, stakeAmountOpts(currency)) })}
        onPreset={(text) => set({ stakeByCurrency: withStake(latestStakes(), currency, text) })}
        onDone={() => keypad.current?.dismiss()}
      />
      <ExpirySheet
        ref={expiry}
        value={expirySec}
        onPick={(sec) => {
          set({ expirySec: sec });
          expiry.current?.dismiss();
        }}
      />
    </View>
  );
}
