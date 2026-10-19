import { memo, useCallback, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, View } from "react-native";
import { Circle, Svg } from "react-native-svg";
import { RING_LENGTH, ringOffset, soonestOpen } from "@asm/client-core";
import type { TradeView } from "@asm/contracts";
import { money } from "@/money/format";
import { useSocket } from "@/socket/socket-store";
import { color, radius } from "@/theme/tokens";
import { Txt } from "@/theme/ui";
import { FigText } from "@/ui/FigText";
import { Money } from "@/ui/Money";
import type { SheetRef } from "@/ui/Sheet";
import type { AppAsset } from "./markets";
import { positionCopy } from "./position-copy";
import { TradesSheet } from "./TradesSheet";
import { useLiveTrade } from "./useLiveTrade";

const NO_TRADES: readonly TradeView[] = [];

/**
 * A pending passbook entry. Ticks on its own each second (and with the price), so the chart and dock around it
 * never re-render for it. Keyed by trade id by the parent, so the frozen figure resets when the soonest trade changes.
 * After the expiry the time reads "Settling…" until the engine's result removes the trade.
 */
const StripBody = memo(function StripBody({
  trade,
  more,
  name,
  precision,
  currency,
  onOpen,
}: {
  trade: TradeView;
  more: number;
  name: string;
  precision: number;
  currency: string;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  const live = useLiveTrade(trade);
  const { remainingSec, totalSec, pnl } = live;
  const dirColor = trade.direction === "UP" ? color.up : color.downText;
  const { side, time, label, detail } = positionCopy(
    { live, direction: trade.direction, name, stake: money(trade.stake, currency), entryPrice: trade.entryPrice, precision, more },
    t,
  );

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onOpen}
      style={({ pressed }) => ({
        minHeight: 52,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingVertical: 9,
        paddingHorizontal: 12,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: color.ruleSoft,
        backgroundColor: pressed ? color.raised : color.surface,
      })}
    >
      <Svg width={34} height={34} viewBox="0 0 34 34" style={{ transform: [{ rotate: "-90deg" }] }}>
        <Circle cx={17} cy={17} r={14} fill="none" strokeWidth={4} stroke={color.rule} />
        <Circle
          cx={17}
          cy={17}
          r={14}
          fill="none"
          strokeWidth={4}
          stroke={dirColor}
          strokeDasharray={RING_LENGTH}
          strokeDashoffset={ringOffset(remainingSec, totalSec)}
        />
      </Svg>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt weight={600} size={15} numberOfLines={1}>
          <Txt weight={600} size={15} color={dirColor}>
            {side}
          </Txt>
          {` ${name} `}
          {/* The time is "Settling…" (Hindi too) after expiry, which Martian cannot set. */}
          <FigText text={time} weight={500} size={12} color={color.ink2} />
        </Txt>
        <FigText text={detail} size={12} tracking={-0.02} color={color.ink3} numberOfLines={1} />
      </View>
      <View style={{ alignItems: "flex-end" }}>
        <Money
          text={pnl === null ? "—" : `${pnl.sign}${money(pnl.amountMinor, currency)}`}
          size={15}
          weight={600}
          color={pnl === null ? color.ink3 : pnl.tone === "up" ? color.up : color.downText}
        />
        <Txt size={12} color={color.ink3}>
          {t("trade.ifClosedNow")}
        </Txt>
      </View>
    </Pressable>
  );
});

/**
 * The soonest-expiring open trade on the selected account (countdown ring, direction, stake at entry price,
 * "if it ends now"), with "+N more" when others are open; tapping it opens the trades sheet. Hidden when nothing
 * is open. The sheet stays mounted either way so it does not vanish under the user when the last open trade settles.
 */
export function PositionStrip({
  accountId,
  accountType,
  assets,
  currency,
}: {
  accountId: string;
  accountType: "DEMO" | "LIVE";
  assets: readonly AppAsset[];
  currency: string;
}) {
  const trades = useSocket((s) => s.trades.tradesByAccount[accountId]) ?? NO_TRADES;
  const soonest = useMemo(() => soonestOpen(trades), [trades]);
  const sheet = useRef<SheetRef>(null);
  const openSheet = useCallback(() => sheet.current?.present(), []);
  const asset = soonest ? assets.find((a) => a.symbol === soonest.trade.symbol) : undefined;
  return (
    <>
      {soonest ? (
        <View style={{ paddingHorizontal: 14, paddingTop: 8 }}>
          <StripBody
            key={soonest.trade.id}
            trade={soonest.trade}
            more={soonest.more}
            name={asset?.displayName ?? soonest.trade.symbol}
            precision={asset?.precision ?? 5}
            currency={currency}
            onOpen={openSheet}
          />
        </View>
      ) : null}
      <TradesSheet ref={sheet} accountId={accountId} accountType={accountType} assets={assets} currency={currency} />
    </>
  );
}
