import { memo, useCallback, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View } from "react-native";
import { Circle, Svg } from "react-native-svg";
import { RING_LENGTH, ringOffset, soonestOpen } from "@asm/client-core";
import { money } from "@/money/format";
import type { TradeView } from "@asm/contracts";
import { useSocket } from "@/socket/socket-store";
import { color, radius, space } from "@/theme/tokens";
import { Icon } from "@/ui/Icon";
import type { SheetRef } from "@/ui/Sheet";
import type { AppAsset } from "./markets";
import { countdownText } from "./countdown-text";
import { DirMark, TradesSheet } from "./TradesSheet";
import { useLiveTrade } from "./useLiveTrade";

const NO_TRADES: readonly TradeView[] = [];

/**
 * Ticks on its own each second (and with the price), so the chart and dock around it never re-render for it.
 * Keyed by trade id by the parent, so the frozen figure resets when the soonest trade changes.
 */
const StripBody = memo(function StripBody({
  trade,
  more,
  name,
  currency,
  onOpen,
}: {
  trade: TradeView;
  more: number;
  name: string;
  currency: string;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  const live = useLiveTrade(trade);
  const { remainingSec, totalSec, pnl } = live;
  const up = trade.direction === "UP";
  const dirColor = up ? color.up : color.down;
  const side = up ? t("trade.buy") : t("trade.sell");
  const stake = money(trade.stake, currency);
  const time = countdownText(live, t("trade.settling"));
  const label =
    (live.expired ? t("trade.positionLabelSettling", { side, name, stake }) : t("trade.positionLabel", { side, name, stake, time })) +
    (more > 0 ? ` ${t("trade.moreOpen", { n: more })}` : "");

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onOpen}
      style={{
        minHeight: 52,
        flexDirection: "row",
        alignItems: "center",
        gap: space(3),
        paddingLeft: space(2),
        paddingRight: space(3),
        backgroundColor: color.tile,
        borderRadius: radius.md,
      }}
    >
      <Svg width={34} height={34} viewBox="0 0 34 34" style={{ transform: [{ rotate: "-90deg" }] }}>
        <Circle cx={17} cy={17} r={14} fill="none" strokeWidth={3} stroke={color.tileHi} />
        <Circle
          cx={17}
          cy={17}
          r={14}
          fill="none"
          strokeWidth={3}
          stroke={dirColor}
          strokeLinecap="round"
          strokeDasharray={RING_LENGTH}
          strokeDashoffset={ringOffset(remainingSec, totalSec)}
        />
      </Svg>
      <View style={{ flex: 1, gap: 1 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space(1) }}>
          <DirMark direction={trade.direction} />
          <Text style={{ color: dirColor, fontSize: 13, fontWeight: "800", fontVariant: ["tabular-nums"] }}>
            {side} · {time}
          </Text>
        </View>
        <Text numberOfLines={1} style={{ color: color.ink2, fontSize: 12 }}>
          {name} · {stake}
          {more > 0 ? ` · ${t("trade.moreOpen", { n: more })}` : ""}
        </Text>
      </View>
      <View style={{ alignItems: "flex-end", gap: 1 }}>
        <Text
          style={{
            color: pnl === null ? color.ink2 : pnl.tone === "up" ? color.up : color.down,
            fontSize: 15,
            fontWeight: "800",
            fontVariant: ["tabular-nums"],
          }}
        >
          {pnl === null ? "—" : `${pnl.sign}${money(pnl.amountMinor, currency)}`}
        </Text>
        <Text style={{ color: color.ink3, fontSize: 10 }}>{t("trade.ifClosedNow")}</Text>
      </View>
      <Icon name="chevron" size={16} color={color.ink3} />
    </Pressable>
  );
});

/**
 * The soonest-expiring open trade on the selected account (countdown ring, direction, stake, "if it closed now"),
 * with "+N more" when others are open; tapping it opens the trades sheet. Hidden when nothing is open. The sheet
 * stays mounted either way so it does not vanish under the user when the last open trade settles.
 */
export function PositionStrip({ accountId, assets, currency }: { accountId: string; assets: readonly AppAsset[]; currency: string }) {
  const trades = useSocket((s) => s.trades.tradesByAccount[accountId]) ?? NO_TRADES;
  const soonest = useMemo(() => soonestOpen(trades), [trades]);
  const sheet = useRef<SheetRef>(null);
  const openSheet = useCallback(() => sheet.current?.present(), []);
  return (
    <>
      {soonest ? (
        <View style={{ paddingHorizontal: space(3), paddingTop: space(2) }}>
          <StripBody
            key={soonest.trade.id}
            trade={soonest.trade}
            more={soonest.more}
            name={assets.find((a) => a.symbol === soonest.trade.symbol)?.displayName ?? soonest.trade.symbol}
            currency={currency}
            onOpen={openSheet}
          />
        </View>
      ) : null}
      <TradesSheet ref={sheet} accountId={accountId} assets={assets} currency={currency} />
    </>
  );
}
