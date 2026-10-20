import { memo } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, View } from "react-native";
import { Circle, Svg } from "react-native-svg";
import { RING_LENGTH, ringOffset } from "@asm/client-core";
import type { TradeView } from "@asm/contracts";
import { money } from "@/money/format";
import { color, radius } from "@/theme/tokens";
import { Txt } from "@/theme/ui";
import { FigText } from "@/ui/FigText";
import { Money } from "@/ui/Money";
import { positionCopy } from "./position-copy";
import { useLiveTrade } from "./useLiveTrade";
/** Countdown updates are isolated from the chart and entry controls. */
export const OpenPositionCard = memo(function OpenPositionCard({
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
  const { side, time, label } = positionCopy(
    { live, direction: trade.direction, name, stake: money(trade.stake, currency), entryPrice: trade.entryPrice, precision, more },
    t,
  );

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onOpen}
      style={({ pressed }) => ({
        minHeight: 64,
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
          {" · "}
          {/* The time is "Settling…" (Hindi too) after expiry, which Martian cannot set. */}
          <FigText text={time} weight={500} size={12} color={color.ink2} />
        </Txt>
        <FigText text={`${name} · ${money(trade.stake, currency)}${more ? ` · +${more}` : ""}`} size={11} tracking={-0.02} color={color.ink3} numberOfLines={1} />
      </View>
      <View style={{ alignItems: "flex-end", flexShrink: 0 }}>
        <Money
          text={pnl === null ? "—" : `${pnl.sign}${money(pnl.amountMinor, currency)}`}
          size={15}
          weight={600}
          color={pnl === null ? color.ink3 : pnl.tone === "up" ? color.up : color.downText}
        />
        {/* One line, never a shrink-wrapped two-line box: multi-word Devanagari measured at its own width can wrap and clip. */}
        <Txt size={12} color={color.ink3} numberOfLines={1}>
          {t("trade.ifClosedNow")}
        </Txt>
      </View>
    </Pressable>
  );
});
