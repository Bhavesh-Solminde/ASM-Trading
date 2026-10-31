import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { color } from "@/theme/tokens";
import { Txt } from "@/theme/ui";
import { useNow } from "@/trade/useNow";
import { Icon } from "@/ui/Icon";
import { countdownText } from "./pay-model";

/**
 * The time left to pay, "mm:ss". A leaf: it re-renders every second, so nothing else may live in it (the screen
 * must never call `useNow`). The digits are ASCII, so they take the figure font. The last minute turns red.
 */
export function ExpiryClock({ expiresAtMs }: { expiresAtMs: number }) {
  const { t } = useTranslation();
  const now = useNow();
  const text = countdownText(expiresAtMs, now);
  const urgent = Number.isFinite(expiresAtMs) && expiresAtMs - now < 60_000;
  const ink = urgent ? color.downText : color.accentText;
  return (
    <View testID="pay-clock" accessible accessibilityRole="timer" accessibilityLabel={`${t("pay.timeLeft")} ${text}`} style={{ flexDirection: "row", alignItems: "center", gap: 5, minHeight: 44 }}>
      <Icon name="timer" size={16} color={ink} />
      <Txt font="fig" size={14} weight={500} color={ink}>
        {text}
      </Txt>
    </View>
  );
}
