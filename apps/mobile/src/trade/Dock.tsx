import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, View } from "react-native";
import { formatDuration, grossReturnMinor, profitForStake } from "@asm/client-core";
import { money } from "@/money/format";
import type { Bootstrap } from "@asm/contracts";
import { useSocket } from "@/socket/socket-store";
import { color, radius } from "@/theme/tokens";
import { Txt } from "@/theme/ui";
import { Money } from "@/ui/Money";
import type { SheetRef } from "@/ui/Sheet";
import { ExpirySheet } from "./ExpirySheet";
import { KeypadSheet } from "./KeypadSheet";
import { payoutPctFor, type AppAsset } from "./markets";
import { prefsFor } from "./prefs-model";
import { stakeProblemText } from "./stake-problem";
import { resolveExpiry, stakeAfterKey, stakeAmountOpts, stakeFor, stakeTileLabel, validateStake, withStake } from "./stake-input";
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
  const { submit, busy } = useTradeSubmit({ accountId, symbol: asset.symbol, stakeMinor: check.ok ? check.minor : null, durationSec: expirySec, currency });
  const keypad = useRef<SheetRef>(null);
  const expiry = useRef<SheetRef>(null);

  if (!account) return null;
  const profit = check.ok ? profitForStake(check.minor, payoutPct) : null;
  const blocked = !check.ok || busy;

  const problem = stakeProblemText(check, currency, t);

  const stakeLabel = stakeTileLabel(stake, currency);


  return (
    <View style={{ paddingTop: 10, paddingHorizontal: 14, paddingBottom: 8, gap: 10, borderTopWidth: 1, borderTopColor: color.ruleSoft, backgroundColor: color.dock }}>
      <View style={{ flexDirection: "row", gap: 10 }}>
        <Pressable testID="stake-tile" accessibilityRole="button" accessibilityLabel={[t("trade.stakeButton", { amount: stakeLabel }), problem].filter(Boolean).join(" ")} onPress={() => keypad.current?.present()} style={{ flex: 1, minHeight: 53, paddingHorizontal: 14, paddingVertical: 6, borderRadius: radius.md, backgroundColor: color.raised, borderWidth: 1, borderColor: problem ? color.downText : color.rule }}>
          <Txt size={11} color={problem ? color.downText : color.ink2} numberOfLines={1}>{problem || t("trade.amount")}</Txt>
          <Money text={stakeLabel} size={20} weight={600} numberOfLines={1} adjustsFontSizeToFit />
        </Pressable>
        <Pressable testID="expiry-tile" accessibilityRole="button" accessibilityLabel={t("trade.expiryOption", { label: formatDuration(expirySec) })} onPress={() => expiry.current?.present()} style={{ flex: 1, minHeight: 53, paddingHorizontal: 14, paddingVertical: 6, borderRadius: radius.md, backgroundColor: color.raised, borderWidth: 1, borderColor: color.rule }}>
          <Txt size={11} color={color.ink2}>{t("redesign.duration")}</Txt>
          <Txt size={20} weight={600}>{formatDuration(expirySec)}  ⌄</Txt>
        </Pressable>
      </View>

      <View style={{ flexDirection: "row", gap: 10 }}>
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
      </View>

      <Txt size={11} color={color.ink2} numberOfLines={1} style={{ textAlign: "center" }}>
        {t("redesign.potentialProfit")}: {profit === null ? "—" : money(profit, currency)}
      </Txt>
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
