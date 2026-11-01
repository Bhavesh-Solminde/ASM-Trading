import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { color } from "@/theme/tokens";
import { Txt } from "@/theme/ui";
import { WaitingRing } from "./PayParts";
import { usdtProgressKey, type UsdtProgress } from "./usdt-progress";

const STEPS = ["usdt.step.detected", "usdt.step.confirmed", "usdt.step.credited"] as const;

/**
 * The on-chain progress of a USDT transfer that has been seen: three steps (Detected, Confirmed, Credited) with the
 * ones behind it filled, and one line saying where it stands. It replaces the "waiting for your payment" card, so a
 * user who already sent is never told to wait for something that has arrived. A failed transfer is red and an alert.
 * Step labels sit in equal columns, so a long Hindi label wraps inside its third; the card has a minimum height only.
 */
export function UsdtProgressCard({ progress }: { progress: UsdtProgress }) {
  const { t } = useTranslation();
  const key = usdtProgressKey(progress.kind);
  const failed = progress.kind === "failed";
  const fill = failed ? color.down : color.accent;
  if (!key) return null;
  return (
    <View testID="usdt-progress" style={{ gap: 12, minHeight: 56, padding: 16, borderRadius: 14, backgroundColor: color.surface }}>
      <View style={{ flexDirection: "row", gap: 6 }} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        {STEPS.map((step, i) => (
          <View key={step} style={{ flex: 1, gap: 6 }}>
            <View style={{ height: 4, borderRadius: 2, backgroundColor: i < progress.done ? fill : color.rule }} />
            <Txt size={12} weight={i < progress.done ? 600 : 400} color={i < progress.done ? color.ink : color.ink3} style={{ textAlign: "center", alignSelf: "stretch" }}>
              {t(step)}
            </Txt>
          </View>
        ))}
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12, minHeight: 32 }}>
        {failed ? null : <WaitingRing />}
        <Txt
          testID="pay-status"
          accessibilityRole={failed ? "alert" : undefined}
          accessibilityLiveRegion="polite"
          size={14}
          weight={failed ? 600 : 400}
          color={failed ? color.downText : color.ink2}
          style={{ flex: 1 }}
        >
          {t(key)}
        </Txt>
      </View>
    </View>
  );
}
