import { forwardRef } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View } from "react-native";
import { formatDuration } from "@asm/client-core";
import { TRADE_DURATIONS_SEC } from "@asm/contracts";
import { color, radius, space } from "@/theme/tokens";
import { Sheet, type SheetRef } from "@/ui/Sheet";

/** Every expiry the server offers, as chips ("30s", "1m", "2h"). The parent applies the pick and closes the sheet. */
export const ExpirySheet = forwardRef<SheetRef, { value: number; onPick: (sec: number) => void }>(function ExpirySheet(
  { value, onPick },
  ref,
) {
  const { t } = useTranslation();

  return (
    <Sheet ref={ref} title={t("trade.expiry")}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2) }}>
        {TRADE_DURATIONS_SEC.map((sec) => {
          const selected = sec === value;
          const label = formatDuration(sec);
          return (
            <Pressable
              key={sec}
              accessibilityRole="button"
              accessibilityLabel={t("trade.expiryOption", { label })}
              accessibilityState={{ selected }}
              onPress={() => onPick(sec)}
              style={{
                width: "23%",
                minHeight: 48,
                borderRadius: radius.sm,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: selected ? color.brandFill : color.tile,
              }}
            >
              <Text style={{ color: selected ? color.brandInk : color.ink, fontWeight: "700", fontSize: 15 }}>{label}</Text>
            </Pressable>
          );
        })}
      </View>
    </Sheet>
  );
});
