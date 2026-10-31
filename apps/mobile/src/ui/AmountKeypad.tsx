import * as Haptics from "expo-haptics";
import { useTranslation } from "react-i18next";
import { Pressable, View } from "react-native";
import { color } from "@/theme/tokens";
import { Txt } from "@/theme/ui";
import { Icon } from "./Icon";

const ROWS = [
  ["1", "2", "3"],
  ["4", "5", "6"],
  ["7", "8", "9"],
  [".", "0", "back"],
] as const;

const light = () => void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

/**
 * The 4x3 ledger keypad shared by the trade stake sheet and the deposit amount sheet. It only reports presses
 * (`onKey("5")`, `onKey("back")`): the owner applies each one to its LATEST amount, so fast presses cannot drop a
 * digit. The "." cell is blank when `decimals` is false. A long press on delete clears (`onClear`).
 * testIDs: `key-<k>` and `key-back`.
 */
export function AmountKeypad({ decimals, onKey, onClear }: { decimals: boolean; onKey: (key: string) => void; onClear: () => void }) {
  const { t } = useTranslation();
  return (
    <View style={{ borderTopWidth: 1, borderTopColor: color.ruleSoft }}>
      {ROWS.map((row) => (
        <View key={row.join("")} style={{ flexDirection: "row" }}>
          {row.map((key, col) => {
            const cell = {
              flex: 1,
              minHeight: 56,
              borderBottomWidth: 1,
              borderLeftWidth: col === 1 ? 1 : 0,
              borderRightWidth: col === 1 ? 1 : 0,
              borderColor: color.ruleSoft,
              alignItems: "center",
              justifyContent: "center",
            } as const;
            if (key === "." && !decimals) return <View key={key} style={cell} />;
            const isBack = key === "back";
            return (
              <Pressable
                key={key}
                testID={`key-${key}`}
                accessibilityRole="button"
                accessibilityLabel={isBack ? t("trade.delete") : key === "." ? t("trade.point") : key}
                onPress={() => {
                  light();
                  onKey(key);
                }}
                onLongPress={isBack ? onClear : undefined}
                style={({ pressed }) => [cell, pressed ? { backgroundColor: color.raised } : null]}
              >
                {isBack ? (
                  <Icon name="delete" size={26} color={color.ink2} />
                ) : (
                  <Txt weight={500} size={27} lineHeight={34} color={key === "." ? color.ink3 : color.ink}>
                    {key}
                  </Txt>
                )}
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}
