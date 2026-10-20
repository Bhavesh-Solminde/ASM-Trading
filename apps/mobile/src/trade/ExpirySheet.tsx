import { forwardRef } from "react";
import { useTranslation } from "react-i18next";
import { useWindowDimensions, View } from "react-native";
import { clockTime, formatDuration } from "@asm/client-core";
import { TRADE_DURATIONS_SEC } from "@asm/contracts";
import { color } from "@/theme/tokens";
import { Txt } from "@/theme/ui";
import { Chip } from "@/ui/Chip";
import { Sheet, type SheetRef } from "@/ui/Sheet";
import { EXPIRY_CHIP_GAP, expiryChipWidth } from "./expiry-layout";
import { useNow } from "./useNow";

/** The clock time a trade placed now would end at; the only part that re-renders each second. */
function EndsAt({ sec }: { sec: number }) {
  const now = useNow(1000);
  return (
    <Txt font="fig" weight={600} size={16} tracking={-0.02} accessibilityLiveRegion="none" style={{ flexShrink: 0 }}>
      {clockTime(Math.floor(now / 1000) + sec)}
    </Txt>
  );
}

/** Every trade length the server offers, plus the exact end time. The parent applies the pick and closes the sheet. */
export const ExpirySheet = forwardRef<SheetRef, { value: number; onPick: (sec: number) => void }>(function ExpirySheet({ value, onPick }, ref) {
  const { t } = useTranslation();
  const { width } = useWindowDimensions();
  const chipWidth = expiryChipWidth(width);
  return (
    <Sheet ref={ref} title={t("trade.tradeLength")} flush>
      <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: EXPIRY_CHIP_GAP, rowGap: EXPIRY_CHIP_GAP, paddingHorizontal: 20 }}>
        {TRADE_DURATIONS_SEC.map((sec) => {
          const label = formatDuration(sec);
          return (
            <Chip
              key={sec}
              label={label}
              height={44}
              size={15}
              selected={sec === value}
              accessibilityLabel={t("trade.expiryOption", { label })}
              onPress={() => onPick(sec)}
              style={{ width: chipWidth }}
            />
          );
        })}
      </View>
      <View
        style={{
          marginTop: 16,
          borderTopWidth: 1,
          borderTopColor: color.ruleSoft,
          paddingHorizontal: 20,
          paddingTop: 16,
          paddingBottom: 28,
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: 12,
        }}
      >
        <Txt size={15} color={color.ink2} style={{ flex: 1 }}>
          {t("trade.endsAt")}
        </Txt>
        <EndsAt sec={value} />
      </View>
    </Sheet>
  );
});
