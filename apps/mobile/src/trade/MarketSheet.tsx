import { BottomSheetTextInput } from "@gorhom/bottom-sheet";
import { forwardRef, useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View } from "react-native";
import { color, radius, space } from "@/theme/tokens";
import { Icon } from "@/ui/Icon";
import { Sheet, type SheetRef } from "@/ui/Sheet";
import { filterMarkets, type AppAsset } from "./markets";

const SNAP_POINTS = ["75%"];

function Row({
  asset,
  active,
  starred,
  onPick,
  onToggleFavourite,
}: {
  asset: AppAsset;
  active: boolean;
  starred: boolean;
  onPick: (symbol: string) => void;
  onToggleFavourite: (symbol: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", borderRadius: radius.md, backgroundColor: active ? color.tile : "transparent" }}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ selected: active }}
        onPress={() => onPick(asset.symbol)}
        style={{ flex: 1, minHeight: 48, flexDirection: "row", alignItems: "center", gap: space(2), paddingLeft: space(3) }}
      >
        <View style={{ flex: 1 }}>
          <Text style={{ color: color.ink, fontSize: 15, fontWeight: active ? "700" : "500" }}>{asset.displayName}</Text>
          <Text style={{ color: color.ink2, fontSize: 12 }}>{asset.symbol}</Text>
        </View>
        <Text style={{ color: color.up, fontWeight: "700", fontVariant: ["tabular-nums"] }}>{t("trade.payout", { pct: asset.payoutPct })}</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t(starred ? "trade.removeFavourite" : "trade.addFavourite", { name: asset.displayName })}
        onPress={() => onToggleFavourite(asset.symbol)}
        style={{ width: 48, height: 48, alignItems: "center", justifyContent: "center" }}
      >
        <Icon name="star" filled={starred} color={starred ? color.caution : color.ink2} />
      </Pressable>
    </View>
  );
}

function SectionTitle({ children }: { children: string }) {
  return <Text style={{ color: color.ink2, fontSize: 12, fontWeight: "700", textTransform: "uppercase", marginTop: space(2) }}>{children}</Text>;
}

/** Searchable market list: starred markets first, then the rest. Picking a row reports the symbol. */
export const MarketSheet = forwardRef<
  SheetRef,
  {
    assets: AppAsset[];
    activeSymbol: string | null;
    favourites: string[];
    onPick: (symbol: string) => void;
    onToggleFavourite: (symbol: string) => void;
  }
>(function MarketSheet({ assets, activeSymbol, favourites, onPick, onToggleFavourite }, ref) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const clear = useCallback(() => setQuery(""), []);
  const { favourites: starred, rest } = filterMarkets(assets, query, favourites);
  const row = (a: AppAsset, isStarred: boolean) => (
    <Row key={a.symbol} asset={a} active={a.symbol === activeSymbol} starred={isStarred} onPick={onPick} onToggleFavourite={onToggleFavourite} />
  );
  return (
    <Sheet ref={ref} title={t("trade.markets")} snapPoints={SNAP_POINTS} scroll onDismiss={clear}>
      <BottomSheetTextInput
        value={query}
        onChangeText={setQuery}
        placeholder={t("trade.search")}
        placeholderTextColor={color.ink3}
        accessibilityLabel={t("trade.search")}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        style={{
          minHeight: 44,
          borderRadius: radius.md,
          backgroundColor: color.tile,
          color: color.ink,
          paddingHorizontal: space(3),
          fontSize: 15,
        }}
      />
      {starred.length > 0 ? (
        <>
          <SectionTitle>{t("trade.favourites")}</SectionTitle>
          {starred.map((a) => row(a, true))}
        </>
      ) : null}
      {rest.length > 0 ? (
        <>
          {starred.length > 0 ? <SectionTitle>{t("trade.markets")}</SectionTitle> : null}
          {rest.map((a) => row(a, false))}
        </>
      ) : null}
      {starred.length === 0 && rest.length === 0 ? (
        <Text style={{ color: color.ink2, textAlign: "center", paddingVertical: space(6) }}>{t("trade.noMarkets")}</Text>
      ) : null}
    </Sheet>
  );
});
