import { useRef } from "react";
import { Sheet, type SheetRef } from "@/ui/Sheet";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { Pressable, useWindowDimensions, View } from "react-native";
import { money } from "@/money/format";
import { useSocket } from "@/socket/socket-store";
import { color, radius } from "@/theme/tokens";
import { Txt } from "@/theme/ui";
import { AppHeader } from "@/ui/AppHeader";
import { BrandMark } from "@/ui/Brand";
import { headerMetrics, PILL_FONT } from "@/ui/header-metrics";
import { Icon } from "@/ui/Icon";
import { Money } from "@/ui/Money";
import { toast } from "@/ui/Toast";
import type { AppAccount } from "./accounts";
import { FIGURE, FILL_RIGHT, TODAY, fitHeader, isCompactWidth } from "./header-fit";

const TYPES = ["DEMO", "LIVE"] as const;

const switchBox = {
  flexDirection: "row",
  padding: 2,
  borderRadius: radius.pill,
  backgroundColor: "rgba(6, 8, 11, 0.55)",
  borderWidth: 1,
  borderColor: color.switchRule,
} as const;

interface TodayLine {
  line: string;
  ink: string;
}

/**
 * The balance with the optional today line above it, right-aligned. Both sizes come from `fitHeader`, chosen
 * from the window width and font scale before the first frame, so no frame ever draws a clipped amount: a
 * wrong-looking balance is worse than a small one. `adjustsFontSizeToFit` stays only as a last-resort backstop.
 */
function BalanceBlock({
  text,
  size,
  ink,
  label,
  today,
  todaySize,
}: {
  text: string;
  size: number;
  ink?: string;
  label: string;
  today?: TodayLine | null;
  todaySize: number | null;
}) {
  return (
    <>
      {today && todaySize !== null ? (
        <Money text={today.line} size={todaySize} style={FILL_RIGHT} numberOfLines={1} weight={500} lineHeight={12} tracking={TODAY.tracking} color={today.ink} />
      ) : null}
      <Money
        text={text}
        size={size}
        weight={600}
        tracking={FIGURE.tracking}
        lineHeight={19}
        numberOfLines={1}
        style={FILL_RIGHT}
        adjustsFontSizeToFit
        minimumFontScale={0.7}
        {...(ink ? { color: ink } : null)}
        accessibilityLabel={label}
      />
    </>
  );
}

/** The balance column inside the header row: whatever room the row leaves, content right-aligned. */
const columnStyle = { flex: 1, alignItems: "flex-end", minWidth: 0 } as const;

/**
 * Mark, Demo/Live switch, the active account's balance (with today's result above it) and a square Deposit
 * button. Live is greyed (and says why when tapped) unless the user has live access and a live account.
 */
export function TopBar({
  account,
  liveEnabled,
  onSelectType,
}: {
  account: AppAccount;
  liveEnabled: boolean;
  onSelectType: (type: AppAccount["type"]) => void;
}) {
  const { t } = useTranslation();
  const bal = useSocket((s) => s.trades.balances[account.id]) ?? account;
  const text = money(Math.round(bal.realBalance + bal.bonusBalance), account.currency);
  const selector = useRef<SheetRef>(null);
  return <>
    <AppHeader>
      <BrandMark width={32} />
      <Pressable testID="account-selector" accessibilityRole="button" accessibilityLabel={t("trade.balance") + ": " + text} onPress={() => selector.current?.present()} style={{ flex: 1, minHeight: 52, alignItems: "center", justifyContent: "center" }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Txt size={12} color={account.type === "LIVE" ? color.up : color.accentText}>{account.type === "LIVE" ? t("trade.live") : t("trade.demo")}</Txt>
          <Icon name="chevronDown" size={12} color={color.ink2} />
        </View>
        <Money text={text} size={22} weight={600} numberOfLines={1} adjustsFontSizeToFit />
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={t("tabs.payments")} onPress={() => router.navigate("/payments")} style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: color.raised, alignItems: "center", justifyContent: "center" }}>
        <Icon name="wallet" size={22} color={color.accentText} />
      </Pressable>
    </AppHeader>
    <Sheet ref={selector} title={t("trade.balance")}>
      {TYPES.map((type) => <Pressable key={type} testID={`account-${type.toLowerCase()}`} accessibilityRole="radio" accessibilityState={{ selected: account.type === type, disabled: type === "LIVE" && !liveEnabled }} onPress={() => {
        if (type === "LIVE" && !liveEnabled) { toast(t("trade.liveLocked")); return; }
        onSelectType(type); selector.current?.dismiss();
      }} style={{ minHeight: 60, padding: 16, borderRadius: 12, backgroundColor: account.type === type ? color.raised : color.surface, flexDirection: "row", justifyContent: "space-between" }}>
        <Txt weight={600}>{type === "LIVE" ? t("trade.live") : t("trade.demo")}</Txt>
        {account.type === type ? <Money text={text} size={16} /> : null}
      </Pressable>)}
    </Sheet>
  </>;
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
  const { width, fontScale } = useWindowDimensions();
  const compact = isCompactWidth(width);
  const metrics = headerMetrics(compact);
  const typeLabel = type === "DEMO" ? t("trade.demo") : t("trade.live");
  const fit = fitHeader({ windowWidth: width, fontScale, pillLabels: [typeLabel], hasDeposit: false, figure: text, today: null });
  const balance = (
    <BalanceBlock
      text={text}
      size={fit.figureSize}
      ink={live ? color.ink : color.ink2}
      label={live ? `${t("trade.balance")}: ${text}` : `${t("trade.balance")}: ${text}. ${t("trade.stale")}`}
      todaySize={null}
    />
  );
  return (
    <AppHeader compact={compact} below={fit.stacked ? balance : undefined}>
      <BrandMark width={metrics.mark} />
      <View style={switchBox}>
        <View style={{ height: 30, paddingHorizontal: metrics.pillPad, justifyContent: "center" }}>
          <Txt weight={600} size={PILL_FONT} lineHeight={16} color={color.switchInk}>
            {typeLabel}
          </Txt>
        </View>
      </View>
      {fit.stacked ? null : <View style={columnStyle}>{balance}</View>}
    </AppHeader>
  );
}
