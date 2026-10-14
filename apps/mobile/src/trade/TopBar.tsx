import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { Pressable, View } from "react-native";
import { money } from "@/money/format";
import { useSocket } from "@/socket/socket-store";
import { color, radius } from "@/theme/tokens";
import { Txt } from "@/theme/ui";
import { AppHeader } from "@/ui/AppHeader";
import { BrandMark } from "@/ui/Brand";
import { Icon } from "@/ui/Icon";
import { Money } from "@/ui/Money";
import { toast } from "@/ui/Toast";
import type { AppAccount } from "./accounts";
import { dayNetForAccount } from "./day-total";
import { useAccountTradesLoaded } from "./useAccountTrades";
import { useNow } from "./useNow";

const TYPES = ["DEMO", "LIVE"] as const;

const switchBox = {
  flexDirection: "row",
  padding: 2,
  borderRadius: radius.pill,
  backgroundColor: "rgba(6, 8, 11, 0.55)",
  borderWidth: 1,
  borderColor: color.switchRule,
} as const;

/**
 * "today +₹186.00": net of today's settled trades on this account. Shown only when this device provably holds the
 * whole IST day for the account (see `dayNetMinor`); hidden while a non-default account's list is still loading.
 * Ticks once a minute for the day boundary.
 */
function TodayLine({ account, listFromBootstrap }: { account: AppAccount; listFromBootstrap: boolean }) {
  const { t } = useTranslation();
  const tradesByAccount = useSocket((s) => s.trades.tradesByAccount);
  const loaded = useAccountTradesLoaded(account.id, !listFromBootstrap);
  const now = useNow(60_000);
  const net = dayNetForAccount(tradesByAccount, account.id, loaded, now);
  if (net === null) return null;
  const amount = `${net > 0 ? "+" : ""}${money(net, account.currency)}`;
  return (
    <Money
      text={t("trade.today", { amount })}
      size={10}
      weight={500}
      lineHeight={12}
      color={net > 0 ? color.up : net < 0 ? color.downText : color.switchInk}
    />
  );
}

/**
 * Mark, Demo/Live switch, the active account's balance (with today's result above it) and a square Deposit
 * button. Live is greyed (and says why when tapped) unless the user has live access and a live account.
 * `bootstrapTradesAccountId` is the account whose trades bootstrap already carries; any other account's trades
 * are fetched for the "today" line.
 */
export function TopBar({
  account,
  liveEnabled,
  onSelectType,
  bootstrapTradesAccountId,
}: {
  account: AppAccount;
  liveEnabled: boolean;
  onSelectType: (type: AppAccount["type"]) => void;
  bootstrapTradesAccountId?: string;
}) {
  const { t } = useTranslation();
  const bal = useSocket((s) => s.trades.balances[account.id]) ?? account;
  const text = money(Math.round(bal.realBalance + bal.bonusBalance), account.currency);
  return (
    <AppHeader>
      <BrandMark width={34} />
      <View accessibilityRole="radiogroup" style={switchBox}>
        {TYPES.map((type) => {
          const selected = account.type === type;
          const blocked = type === "LIVE" && !liveEnabled;
          return (
            <Pressable
              key={type}
              testID={`account-${type.toLowerCase()}`}
              accessibilityRole="radio"
              accessibilityState={{ selected, disabled: blocked }}
              onPress={() => (blocked ? toast(t("trade.liveLocked")) : onSelectType(type))}
              // 30pt pill + 7pt above and below = the 44pt target.
              hitSlop={{ top: 7, bottom: 7 }}
              style={{
                height: 30,
                minWidth: 44,
                paddingHorizontal: 11,
                borderRadius: radius.pill,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: selected ? color.ink : "transparent",
                opacity: blocked ? 0.45 : 1,
              }}
            >
              <Txt weight={600} size={13} lineHeight={16} color={selected ? color.ground : color.switchInk}>
                {type === "DEMO" ? t("trade.demo") : t("trade.live")}
              </Txt>
            </Pressable>
          );
        })}
      </View>
      <View style={{ flex: 1, alignItems: "flex-end", minWidth: 0 }}>
        <TodayLine account={account} listFromBootstrap={account.id === bootstrapTradesAccountId} />
        <Money
          text={text}
          size={16}
          weight={600}
          tracking={-0.04}
          lineHeight={19}
          numberOfLines={1}
          adjustsFontSizeToFit
          accessibilityLabel={`${t("trade.balance")}: ${text}`}
        />
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("trade.deposit")}
        // The real deposit flow arrives with the payments work; until then this opens the Payments tab.
        onPress={() => router.navigate("/payments")}
        // 40pt square + 2pt around = the 44pt target.
        hitSlop={2}
        style={({ pressed }) => ({
          width: 40,
          height: 40,
          borderRadius: radius.md,
          backgroundColor: color.accent,
          alignItems: "center",
          justifyContent: "center",
          opacity: pressed ? 0.85 : 1,
        })}
      >
        <Icon name="plus" size={20} strokeWidth={2.25} color={color.onAccent} />
      </Pressable>
    </AppHeader>
  );
}

/**
 * The header from the resume cache, shown until bootstrap arrives: the last known balance, dimmed, with the
 * account type but no controls (the switch and deposit need live account data). The screen-reader label says the
 * figure is saved data, so it never reads as current money. A balance the store already received (`live`) is
 * shown at full strength and without that wording. No "today" line: nothing proves the day's trades yet.
 */
export function StaleTopBar({
  totalMinor,
  type,
  currency,
  live = false,
}: {
  totalMinor: number;
  type: AppAccount["type"];
  currency: string;
  live?: boolean;
}) {
  const { t } = useTranslation();
  const text = money(totalMinor, currency);
  return (
    <AppHeader>
      <BrandMark width={34} />
      <View style={switchBox}>
        <View style={{ height: 30, paddingHorizontal: 11, justifyContent: "center" }}>
          <Txt weight={600} size={13} lineHeight={16} color={color.switchInk}>
            {type === "DEMO" ? t("trade.demo") : t("trade.live")}
          </Txt>
        </View>
      </View>
      <View style={{ flex: 1, alignItems: "flex-end", minWidth: 0 }}>
        <Money
          text={text}
          size={16}
          weight={600}
          tracking={-0.04}
          lineHeight={19}
          numberOfLines={1}
          adjustsFontSizeToFit
          color={live ? color.ink : color.ink2}
          accessibilityLabel={live ? `${t("trade.balance")}: ${text}` : `${t("trade.balance")}: ${text}. ${t("trade.stale")}`}
        />
      </View>
    </AppHeader>
  );
}
