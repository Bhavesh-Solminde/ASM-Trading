import * as Haptics from "expo-haptics";
import { forwardRef } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View } from "react-native";
import { applyKey, formatMinor, stakePresets, stakeToMinor } from "@asm/client-core";
import { color, radius, space } from "@/theme/tokens";
import { Button } from "@/theme/ui";
import { Sheet, type SheetRef } from "@/ui/Sheet";
import { stakeAmountOpts, stakeDisplay } from "./stake-input";

const ROWS = [
  ["1", "2", "3"],
  ["4", "5", "6"],
  ["7", "8", "9"],
  [".", "0", "back"],
] as const;

const keyBox = { flex: 1, minHeight: 52, borderRadius: radius.md, alignItems: "center", justifyContent: "center" } as const;

/** Big amount, quick amounts, a 3×4 keypad and Done. Every press goes through client-core's `applyKey`. */
export const KeypadSheet = forwardRef<SheetRef, { currency: string; value: string; onChange: (next: string) => void; onDone: () => void }>(
  function KeypadSheet({ currency, value, onChange, onDone }, ref) {
    const { t } = useTranslation();
    const opts = stakeAmountOpts(currency);

    const press = (key: string) => {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      onChange(applyKey(value, key, opts));
    };

    return (
      <Sheet ref={ref} title={t("trade.stakeKeypad")}>
        <Text
          accessibilityLabel={`${t("trade.stake")}: ${stakeDisplay(value)}`}
          accessibilityLiveRegion="polite"
          style={{ color: color.ink, fontSize: 40, fontWeight: "800", textAlign: "center", fontVariant: ["tabular-nums"] }}
        >
          {stakeDisplay(value)}
        </Text>
        <View style={{ flexDirection: "row", gap: space(2) }}>
          {stakePresets(currency).map((amount) => {
            const selected = value === String(amount);
            return (
              <Pressable
                key={amount}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => {
                  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  onChange(String(amount));
                }}
                style={{ ...keyBox, minHeight: 44, borderRadius: radius.sm, backgroundColor: selected ? color.brandFill : color.tile }}
              >
                <Text style={{ color: selected ? color.brandInk : color.ink, fontWeight: "700", fontSize: 13 }} numberOfLines={1}>
                  {formatMinor(stakeToMinor(String(amount)), currency)}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <View style={{ gap: space(2) }}>
          {ROWS.map((row) => (
            <View key={row.join("")} style={{ flexDirection: "row", gap: space(2) }}>
              {row.map((key) => {
                if (key === "." && !opts.decimals) return <View key={key} style={{ flex: 1 }} />;
                const isBack = key === "back";
                return (
                  <Pressable
                    key={key}
                    accessibilityRole="button"
                    accessibilityLabel={isBack ? t("trade.delete") : key === "." ? t("trade.point") : key}
                    onPress={() => press(key)}
                    onLongPress={isBack ? () => onChange("") : undefined}
                    style={({ pressed }) => ({ ...keyBox, backgroundColor: pressed ? color.tileHi : color.tile })}
                  >
                    <Text style={{ color: color.ink, fontSize: 22, fontWeight: "700" }}>{isBack ? "⌫" : key}</Text>
                  </Pressable>
                );
              })}
            </View>
          ))}
        </View>
        <Button label={t("common.done")} onPress={onDone} />
      </Sheet>
    );
  },
);
