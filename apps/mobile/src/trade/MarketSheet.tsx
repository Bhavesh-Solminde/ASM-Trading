import { BottomSheetTextInput } from "@gorhom/bottom-sheet";
import { forwardRef, useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, ScrollView, View } from "react-native";
import { color, radius } from "@/theme/tokens";
import { Txt, inputFont, useUiFamily } from "@/theme/ui";
import { Chip } from "@/ui/Chip";
import { Icon } from "@/ui/Icon";
import { Sheet, type SheetRef } from "@/ui/Sheet";
import { Stamp } from "@/ui/Stamp";
import { clockHm, marketReopensAt } from "./market-hours";
import { categoriesFor, filterMarkets, inCategory, type AppAsset, type MarketCategory } from "./markets";

const SNAP_POINTS = ["75%", "92%"];
const CATEGORY_KEY: Record<MarketCategory, string> = {
  all: "trade.catAll",
  starred: "trade.catStarred",
  CRYPTO: "trade.catCrypto",
  INDEX: "trade.catIndex",
  FOREX: "trade.catForex",
  COMMODITY: "trade.catCommodity",
};
const CLASS_KEY: Record<string, string> = {
  CRYPTO: "trade.catCrypto",
  INDEX: "trade.catIndex",
  FOREX: "trade.catForex",
  COMMODITY: "trade.catCommodity",
};

function Row({
  asset,
  active,
  starred,
  nowMs,
  onPick,
  onToggleFavourite,
}: {
  asset: AppAsset;
  active: boolean;
  starred: boolean;
  nowMs: number;
  onPick: (symbol: string) => void;
  onToggleFavourite: (symbol: string) => void;
}) {
  const { t } = useTranslation();
  const classKey = CLASS_KEY[asset.assetClass];
  const reopensAt = marketReopensAt(asset.symbol, nowMs);
  const subtitle = reopensAt !== null ? t("trade.closedOpens", { time: clockHm(reopensAt) }) : classKey ? t(classKey) : asset.symbol;
  const payout = t("trade.payout", { pct: asset.payoutPct });
  return (
    <View style={{ flexDirection: "row", alignItems: "center", borderBottomWidth: 1, borderBottomColor: color.ruleSoft, backgroundColor: active ? color.raised : "transparent" }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={reopensAt !== null ? `${asset.displayName}, ${subtitle}` : `${asset.displayName}, ${subtitle}, ${payout}`}
        accessibilityState={{ selected: active }}
        onPress={() => onPick(asset.symbol)}
        style={{ flex: 1, minHeight: 56, flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, paddingLeft: 20 }}
      >
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt weight={600} size={16} color={reopensAt !== null ? color.ink2 : color.ink} numberOfLines={1}>
            {asset.displayName}
          </Txt>
          <Txt size={13} color={color.ink3} numberOfLines={1}>
            {subtitle}
          </Txt>
        </View>
        {reopensAt !== null ? (
          <Stamp label={t("trade.closed")} tone="accent" />
        ) : (
          <Txt font="fig" weight={600} size={14} color={color.up} style={{ width: 44, textAlign: "right" }}>
            {payout}
          </Txt>
        )}
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t(starred ? "trade.removeFavourite" : "trade.addFavourite", { name: asset.displayName })}
        onPress={() => onToggleFavourite(asset.symbol)}
        style={{ width: 52, height: 52, alignItems: "center", justifyContent: "center" }}
      >
        <Icon name="star" filled={starred} color={starred ? color.gold : color.ink3} />
      </Pressable>
    </View>
  );
}

/** Searchable market list with category chips; starred markets first. Picking a row reports the symbol. */
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
  const family = useUiFamily(400);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<MarketCategory>("all");
  const reset = useCallback(() => {
    setQuery("");
    setCategory("all");
  }, []);
  const { favourites: starred, rest } = filterMarkets(assets, query, favourites);
  const categories = categoriesFor(assets, favourites);
  // The Starred chip goes when the last star is removed: fall back to All instead of an empty, chip-less filter.
  const activeCategory = categories.includes(category) ? category : "all";
  const shown = [...starred.map((a) => ({ a, star: true })), ...rest.map((a) => ({ a, star: false }))].filter(({ a }) => inCategory(a, activeCategory, favourites));
  const nowMs = Date.now();
  return (
    <Sheet ref={ref} title={t("trade.markets")} snapPoints={SNAP_POINTS} scroll flush onDismiss={reset}>
      <View style={{ paddingHorizontal: 20 }}>
        <View style={{ height: 48, borderRadius: radius.md, borderWidth: 1, borderColor: color.rule, backgroundColor: color.ground, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14 }}>
          <Icon name="search" size={18} color={color.ink3} />
          <BottomSheetTextInput
            value={query}
            onChangeText={setQuery}
            placeholder={t("trade.search")}
            placeholderTextColor={color.ink3}
            accessibilityLabel={t("trade.search")}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            style={{ flex: 1, height: 46, color: color.ink, fontSize: 16, ...inputFont(family, 400) }}
          />
        </View>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 8, paddingHorizontal: 20, paddingVertical: 12 }}>
        {categories.map((c) => (
          <Chip key={c} label={t(CATEGORY_KEY[c])} selected={activeCategory === c} onPress={() => setCategory(c)} style={{ paddingHorizontal: 16 }} size={15} />
        ))}
      </ScrollView>
      <View style={{ borderTopWidth: 1, borderTopColor: color.ruleSoft }}>
        {shown.map(({ a, star }) => (
          <Row key={a.symbol} asset={a} active={a.symbol === activeSymbol} starred={star} nowMs={nowMs} onPick={onPick} onToggleFavourite={onToggleFavourite} />
        ))}
        {shown.length === 0 ? (
          <Txt color={color.ink2} style={{ textAlign: "center", paddingVertical: 24 }}>
            {t("trade.noMarkets")}
          </Txt>
        ) : null}
      </View>
      <View style={{ height: 20 }} />
    </Sheet>
  );
});
