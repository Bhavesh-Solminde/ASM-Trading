import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View } from "react-native";
import { EXPIRY_CHIPS, formatDuration, formatMinor, isChipExpiry, minStakeMinor, profitForStake } from "@asm/client-core";
import type { Bootstrap } from "@asm/contracts";
import { useSocket } from "@/socket/socket-store";
import { color, font, radius, space } from "@/theme/tokens";
import type { SheetRef } from "@/ui/Sheet";
import { ExpirySheet } from "./ExpirySheet";
import { KeypadSheet } from "./KeypadSheet";
import { payoutPctFor, type AppAsset } from "./markets";
import { prefsFor } from "./prefs-model";
import { MAX_STAKE_MINOR, resolveExpiry, stakeAfterKey, stakeAmountOpts, stakeDisplay, stakeFor, validateStake, withStake } from "./stake-input";
import { useTradePrefs, useUserPrefs } from "./trade-prefs";
import { useTradeSubmit } from "./useTradeSubmit";

/**
 * Stake, expiry and Buy/Sell. The tab bar below already adds the bottom safe-area inset, so the dock has none.
 * Stake and expiry are saved per user; the typed stake is checked against real + bonus balance, as the server does.
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
  const { submit, busy } = useTradeSubmit({ accountId, symbol: asset.symbol, stakeMinor: check.ok ? check.minor : null, durationSec: expirySec });
  const keypad = useRef<SheetRef>(null);
  const expiry = useRef<SheetRef>(null);

  if (!account) return null;
  const profit = check.ok ? profitForStake(check.minor, payoutPct) : null;
  const blocked = !check.ok || busy;

  const problem = !check.ok
    ? check.reason === "min"
      ? t("trade.minStake", { amount: formatMinor(minStakeMinor(currency), currency) })
      : check.reason === "max"
        ? t("trade.maxStake", { amount: formatMinor(MAX_STAKE_MINOR, currency) })
        : check.reason === "balance"
          ? t("trade.insufficient")
          : null
    : null;

  const stakeLabel = check.ok ? formatMinor(check.minor, currency) : stake === "" ? "—" : stakeDisplay(stake);

  return (
    <View
      style={{
        padding: space(3),
        gap: space(2),
        backgroundColor: color.panel,
        borderTopLeftRadius: radius.lg,
        borderTopRightRadius: radius.lg,
      }}
    >
      <Pressable
        testID="stake-tile"
        accessibilityRole="button"
        accessibilityLabel={t("trade.stakeButton", { amount: stakeLabel })}
        onPress={() => keypad.current?.present()}
        style={{
          minHeight: 48,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          backgroundColor: color.tile,
          borderRadius: radius.md,
          paddingHorizontal: space(4),
        }}
      >
        <Text style={{ color: color.ink2, fontSize: 13 }}>{t("trade.stake")}</Text>
        <Text style={{ ...font.number, color: problem ? color.down : color.ink, fontSize: 20, fontWeight: "800" }}>{stakeLabel}</Text>
      </Pressable>

      <View style={{ flexDirection: "row", gap: space(2) }}>
        {EXPIRY_CHIPS.map((c) => {
          const selected = expirySec === c.sec;
          return (
            <Pressable
              key={c.sec}
              testID={`expiry-${c.sec}`}
              accessibilityRole="button"
              accessibilityLabel={t("trade.expiryOption", { label: formatDuration(c.sec) })}
              accessibilityState={{ selected }}
              onPress={() => set({ expirySec: c.sec })}
              style={{
                flex: 1,
                minHeight: 44,
                borderRadius: radius.sm,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: selected ? color.brandFill : color.tile,
              }}
            >
              <Text style={{ color: selected ? color.brandInk : color.ink, fontWeight: "700", fontSize: 13 }}>{formatDuration(c.sec)}</Text>
            </Pressable>
          );
        })}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={isChipExpiry(expirySec) ? t("trade.more") : t("trade.expiryOption", { label: formatDuration(expirySec) })}
          accessibilityState={{ selected: !isChipExpiry(expirySec) }}
          onPress={() => expiry.current?.present()}
          style={{
            flex: 1,
            minHeight: 44,
            borderRadius: radius.sm,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: isChipExpiry(expirySec) ? color.tile : color.brandFill,
          }}
        >
          <Text style={{ color: isChipExpiry(expirySec) ? color.ink : color.brandInk, fontWeight: "700", fontSize: 13 }} numberOfLines={1}>
            {isChipExpiry(expirySec) ? t("trade.more") : formatDuration(expirySec)}
          </Text>
        </Pressable>
      </View>

      {problem ? (
        <Text accessibilityLiveRegion="polite" style={{ color: color.down, fontSize: 12 }}>
          {problem}
        </Text>
      ) : null}

      <View style={{ flexDirection: "row", gap: space(2) }}>
        {(["UP", "DOWN"] as const).map((dir) => {
          const up = dir === "UP";
          const ink = up ? color.upInk : color.downInk;
          const label = up ? t("trade.buy") : t("trade.sell");
          const payoutText = payoutPct !== null ? t("trade.payout", { pct: payoutPct }) : "";
          const profitText = profit !== null ? `+${formatMinor(profit, currency)}` : "";
          return (
            <Pressable
              key={dir}
              testID={up ? "buy" : "sell"}
              accessibilityRole="button"
              accessibilityLabel={[label, payoutText, profitText].filter(Boolean).join(", ")}
              accessibilityState={{ disabled: blocked, busy }}
              disabled={blocked}
              onPress={() => void submit(dir)}
              style={({ pressed }) => ({
                flex: 1,
                minHeight: 56,
                borderRadius: radius.md,
                backgroundColor: up ? color.up : color.down,
                opacity: blocked ? 0.5 : pressed ? 0.85 : 1,
                alignItems: "center",
                justifyContent: "center",
              })}
            >
              <Text style={{ color: ink, fontSize: 18, fontWeight: "800" }}>{label}</Text>
              <Text style={{ ...font.number, color: ink, fontSize: 12, fontWeight: "600" }}>
                {[payoutText, profitText].filter(Boolean).join(" · ")}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <KeypadSheet
        ref={keypad}
        currency={currency}
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
