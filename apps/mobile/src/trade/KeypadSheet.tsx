import * as Haptics from "expo-haptics";
import { forwardRef } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View } from "react-native";
import { stakePresets, stakeToMinor } from "@asm/client-core";
import { money } from "@/money/format";
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

/**
 * Big amount, quick amounts, a 3×4 keypad and Done. It only reports presses: the owner applies each one to the
 * LATEST saved stake (`stakeAfterKey`), never to the `value` it rendered, so fast presses cannot drop a digit.
 */
export const KeypadSheet = forwardRef<SheetRef, { currency: string; value: string; onKey: (key: string) => void; onPreset: (text: string) => void; onDone: () => void }>(
  function KeypadSheet({ currency, value, onKey, onPreset, onDone }, ref) {
    const { t } = useTranslation();
    const opts = stakeAmountOpts(currency);

    const press = (key: string) => {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      onKey(key);
    };

    return (
      <Sheet ref={ref} title={t("trade.stakeKeypad")}>
        <Text
          accessibilityLabel={`${t("trade.stake")}: ${stakeDisplay(value, currency)}`}
          accessibilityLiveRegion="polite"
          style={{ color: color.ink, fontSize: 40, fontWeight: "800", textAlign: "center", fontVariant: ["tabular-nums"] }}
        >
          {stakeDisplay(value, currency)}
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
                  onPreset(String(amount));
                }}
                style={{ ...keyBox, minHeight: 44, borderRadius: radius.sm, backgroundColor: selected ? color.brandFill : color.tile }}
              >
                <Text style={{ color: selected ? color.brandInk : color.ink, fontWeight: "700", fontSize: 13 }} numberOfLines={1}>
                  {money(stakeToMinor(String(amount)), currency)}
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
                    testID={`key-${key}`}
                    accessibilityRole="button"
                    accessibilityLabel={isBack ? t("trade.delete") : key === "." ? t("trade.point") : key}
                    onPress={() => press(key)}
                    onLongPress={isBack ? () => onPreset("") : undefined}
                    style={({ pressed }) => ({ ...keyBox, backgroundColor: pressed ? color.tileHi : color.tile })}
                  >
                    <Text style={{ color: color.ink, fontSize: 22, fontWeight: "700" }}>{isBack ? "⌫" : key}</Text>
                  </Pressable>
                );
              })}
            </View>
          ))}
        </View>
        <Button testID="keypad-done" label={t("common.done")} onPress={onDone} />
      </Sheet>
    );
  },
);
