import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { Pressable } from "react-native";
import { useSocket } from "@/socket/socket-store";
import { color, radius } from "@/theme/tokens";
import { Txt } from "@/theme/ui";
import { Icon } from "@/ui/Icon";
import type { SheetRef } from "@/ui/Sheet";
import { payoutPctFor, type AppAsset } from "./markets";
import { MarketSheet } from "./MarketSheet";

/** The active market's name and payout; opens the market list. Always visible over the chart. */
export function MarketPill({
  assets,
  asset,
  favourites,
  onPick,
  onToggleFavourite,
}: {
  assets: AppAsset[];
  asset: AppAsset | undefined;
  favourites: string[];
  onPick: (symbol: string) => void;
  onToggleFavourite: (symbol: string) => void;
}) {
  const { t } = useTranslation();
  const sheet = useRef<SheetRef>(null);
  const symbol = asset?.symbol ?? null;
  const livePayout = useSocket((s) => (symbol !== null && s.chart.symbol === symbol ? s.chart.payoutPct : null));
  const payout = payoutPctFor(asset, livePayout);
  const name = asset?.displayName ?? "";
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("trade.selectMarket", { name })}
        onPress={() => sheet.current?.present()}
        hitSlop={2}
        style={({ pressed }) => ({
          height: 40,
          maxWidth: 220,
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          paddingHorizontal: 12,
          borderRadius: radius.pill,
          backgroundColor: pressed ? color.raised : color.overlayPill,
          borderWidth: 1,
          borderColor: color.rule,
        })}
      >
        <Txt weight={600} size={15} numberOfLines={1} style={{ flexShrink: 1 }}>
          {name}
        </Txt>
        {payout !== null ? (
          <Txt font="fig" weight={500} size={13} color={color.up}>
            {t("trade.payout", { pct: payout })}
          </Txt>
        ) : null}
        <Icon name="chevronDown" size={16} strokeWidth={2} color={color.ink3} />
      </Pressable>
      <MarketSheet
        ref={sheet}
        assets={assets}
        activeSymbol={symbol}
        favourites={favourites}
        onPick={(s) => {
          sheet.current?.dismiss();
          onPick(s);
        }}
        onToggleFavourite={onToggleFavourite}
      />
    </>
  );
}
