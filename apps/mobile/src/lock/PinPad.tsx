import * as Haptics from "expo-haptics";
import { useTranslation } from "react-i18next";
import { Pressable, View } from "react-native";
import { color } from "@/theme/tokens";
import { Txt } from "@/theme/ui";
import { Icon, type IconName } from "@/ui/Icon";

const DELETE = "delete";
const LEFT = "left";
const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", LEFT, "0", DELETE] as const;

/**
 * Full-width ledger keypad (no grey tiles). The PIN boxes are separate (`PinBoxes`). `leftKey` fills the bottom-left cell
 * (a fingerprint key); without it the cell is empty.
 */
export function PinPad({
  value,
  onChange,
  disabled,
  leftKey,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  leftKey?: { icon: IconName; label: string; onPress: () => void };
}) {
  const { t } = useTranslation();

  function press(k: string) {
    if (disabled) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (k === DELETE) onChange(value.slice(0, -1));
    else if (value.length < 4) onChange(value + k);
  }

  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", borderTopWidth: 1, borderTopColor: color.ruleSoft }}>
      {KEYS.map((k, i) => {
        const col = i % 3;
        // minHeight, not height: the digits scale with the system font size.
        const cell = {
          width: "33.333%",
          minHeight: 64,
          borderBottomWidth: 1,
          borderLeftWidth: col === 1 ? 1 : 0,
          borderRightWidth: col === 1 ? 1 : 0,
          borderColor: color.ruleSoft,
          alignItems: "center",
          justifyContent: "center",
        } as const;
        if (k === LEFT) {
          return leftKey ? (
            <Pressable
              key={k}
              accessibilityRole="button"
              accessibilityLabel={leftKey.label}
              onPress={leftKey.onPress}
              style={({ pressed }) => [cell, pressed ? { backgroundColor: color.raised } : null]}
            >
              <Icon name={leftKey.icon} size={26} color={color.accentText} />
            </Pressable>
          ) : (
            <View key={k} style={cell} />
          );
        }
        return (
          <Pressable
            key={k}
            testID={`pin-${k}`}
            accessibilityRole="button"
            accessibilityLabel={k === DELETE ? t("lock.delete") : k}
            accessibilityState={{ disabled: !!disabled }}
            onPress={() => press(k)}
            style={({ pressed }) => [cell, { opacity: disabled ? 0.5 : 1 }, pressed ? { backgroundColor: color.raised } : null]}
          >
            {k === DELETE ? (
              <Icon name="delete" size={26} color={color.ink2} />
            ) : (
              <Txt weight={500} size={27} lineHeight={34}>
                {k}
              </Txt>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}
