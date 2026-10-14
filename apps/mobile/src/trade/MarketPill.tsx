import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text } from "react-native";
import { useSocket } from "@/socket/socket-store";
import { color, radius, space } from "@/theme/tokens";
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
        style={{
          minHeight: 44,
          flexDirection: "row",
          alignItems: "center",
          gap: space(2),
          paddingHorizontal: space(3),
          borderRadius: radius.pill,
          backgroundColor: color.panel,
          borderWidth: 1,
          borderColor: color.rule,
        }}
      >
        <Text style={{ color: color.ink, fontWeight: "700", fontSize: 14 }}>{name}</Text>
        {payout !== null ? <Text style={{ color: color.up, fontWeight: "700", fontSize: 13 }}>{t("trade.payout", { pct: payout })}</Text> : null}
        <Text style={{ color: color.ink2, fontSize: 12 }}>▾</Text>
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
