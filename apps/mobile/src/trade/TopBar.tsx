import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { Pressable, useWindowDimensions, View } from "react-native";
import { money } from "@/money/format";
import { useSocket } from "@/socket/socket-store";
import { color, radius } from "@/theme/tokens";
import { Txt } from "@/theme/ui";
import { AppHeader } from "@/ui/AppHeader";
import { BrandMark } from "@/ui/Brand";
import { headerMetrics, PILL_FONT, PILL_MIN_WIDTH } from "@/ui/header-metrics";
import { Icon } from "@/ui/Icon";
import { Money } from "@/ui/Money";
import { PillFill } from "@/ui/PillFill";
import { toast } from "@/ui/Toast";
import type { AppAccount } from "./accounts";
import { dayNetForAccount } from "./day-total";
import { FIGURE, FILL_RIGHT, TODAY, fitHeader, isCompactWidth } from "./header-fit";
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

interface TodayLine {
  line: string;
  ink: string;
}

/**
 * "+₹186.00 today": net of today's settled trades on this account. Null (nothing shown) unless this device
 * provably holds the whole IST day for the account (see `dayNetMinor`); hidden while a non-default account's list
 * is still loading. Ticks once a minute for the day boundary.
 */
function useTodayLine(account: AppAccount, listLoaded: boolean): TodayLine | null {
  const { t } = useTranslation();
  const tradesByAccount = useSocket((s) => s.trades.tradesByAccount);
  const now = useNow(60_000);
  const net = dayNetForAccount(tradesByAccount, account.id, listLoaded, now);
  if (net === null) return null;
  const amount = `${net > 0 ? "+" : ""}${money(net, account.currency)}`;
  return { line: t("trade.today", { amount }), ink: net > 0 ? color.up : net < 0 ? color.downText : color.switchInk };
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
 * `listLoaded` says the active account's trade list is complete (see `useAccountTradesLoaded`, owned by the
 * screen); the "today" line is hidden until it is.
 */
export function TopBar({
  account,
  liveEnabled,
  onSelectType,
  listLoaded,
}: {
  account: AppAccount;
  liveEnabled: boolean;
  onSelectType: (type: AppAccount["type"]) => void;
  listLoaded: boolean;
}) {
  const { t } = useTranslation();
  const bal = useSocket((s) => s.trades.balances[account.id]) ?? account;
  const text = money(Math.round(bal.realBalance + bal.bonusBalance), account.currency);
  const today = useTodayLine(account, listLoaded);
  // 320dp and 360dp phones: a smaller mark, tighter gutters and pills leave the balance room for every digit. The
  // fit is computed from the window, so it follows a font-scale change and is right on the first frame.
  const { width, fontScale } = useWindowDimensions();
  const compact = isCompactWidth(width);
  const metrics = headerMetrics(compact);
  const fit = fitHeader({
    windowWidth: width,
    fontScale,
    pillLabels: [t("trade.demo"), t("trade.live")],
    hasDeposit: true,
    figure: text,
    today: today?.line ?? null,
  });
  const balance = (
    <BalanceBlock text={text} size={fit.figureSize} label={`${t("trade.balance")}: ${text}`} today={today} todaySize={fit.todaySize} />
  );
  return (
    <AppHeader compact={compact} below={fit.stacked ? balance : undefined}>
      <BrandMark width={metrics.mark} />
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
                minWidth: PILL_MIN_WIDTH,
                paddingHorizontal: metrics.pillPad,
                alignItems: "center",
                justifyContent: "center",
                opacity: blocked ? 0.45 : 1,
              }}
            >
              {/* Drawn by SVG: a view whose backgroundColor toggles loses its rounded corners on Android. */}
              <PillFill fill={selected ? color.ink : null} height={30} />
              <Txt weight={600} size={PILL_FONT} lineHeight={16} color={selected ? color.ground : color.switchInk}>
                {type === "DEMO" ? t("trade.demo") : t("trade.live")}
              </Txt>
            </Pressable>
          );
        })}
      </View>
      {/* When the figure cannot fit here at a legible size it sits in a second header row instead. */}
      {fit.stacked ? <View style={{ flex: 1 }} /> : <View style={columnStyle}>{balance}</View>}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("trade.deposit")}
        onPress={() => router.navigate("/payments/deposit")}
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
