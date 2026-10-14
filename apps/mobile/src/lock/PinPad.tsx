import * as Haptics from "expo-haptics";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { color, radius, space } from "@/theme/tokens";

const DELETE = "delete";
const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", DELETE];

export function PinPad({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();

  function press(k: string) {
    if (disabled) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (k === DELETE) onChange(value.slice(0, -1));
    else if (value.length < 4) onChange(value + k);
  }

  return (
    <View style={{ gap: space(6) }}>
      <View
        style={styles.dots}
        accessible
        accessibilityLabel={t("lock.pinEntered", { count: value.length })}
      >
        {[0, 1, 2, 3].map((i) => (
          <View key={i} style={[styles.dot, i < value.length && { backgroundColor: color.brand, borderColor: color.brand }]} />
        ))}
      </View>
      <View style={styles.grid}>
        {KEYS.map((k, i) =>
          k === "" ? (
            <View key={i} style={styles.key} />
          ) : (
            <Pressable
              key={i}
              accessibilityRole="button"
              accessibilityLabel={k === DELETE ? t("lock.delete") : k}
              accessibilityState={{ disabled: !!disabled }}
              onPress={() => press(k)}
              style={({ pressed }) => [styles.key, styles.keyFace, { opacity: disabled ? 0.5 : pressed ? 0.7 : 1 }]}
            >
              <Text style={styles.keyText}>{k === DELETE ? "⌫" : k}</Text>
            </Pressable>
          ),
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  dots: { flexDirection: "row", justifyContent: "center", gap: space(4) },
  dot: { width: 14, height: 14, borderRadius: 7, borderWidth: 1, borderColor: color.ink2 },
  grid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", alignSelf: "center", width: 76 * 3 + space(3) * 2, gap: space(3) },
  key: { width: 76, height: 64 },
  keyFace: { borderRadius: radius.md, alignItems: "center", justifyContent: "center", backgroundColor: color.tile },
  keyText: { color: color.ink, fontSize: 24, fontWeight: "600" },
});
