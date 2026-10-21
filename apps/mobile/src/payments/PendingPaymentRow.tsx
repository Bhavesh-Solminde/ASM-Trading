import { router } from "expo-router";
import { Pressable, View } from "react-native";
import { useTranslation } from "react-i18next";
import { money } from "@/money/format";
import { color } from "@/theme/tokens";
import { Txt } from "@/theme/ui";
import { useNow } from "@/trade/useNow";
import { Icon } from "@/ui/Icon";
import { IconTile } from "@/ui/IconTile";
import { Money } from "@/ui/Money";
import { pendingPaymentRow, type PendingRow } from "./hub-model";
import { amountText } from "./result-model";

/**
 * "Payment in progress · ₹x · Continue": the way back to a deposit the user started and has not finished. A leaf: it
 * checks the clock every 15s so the row goes away by itself when the payment window ends. The server-confirmed open
 * checkout from `pendingRowDecision`.
 */
export function PendingPaymentRow({ pending }: { pending: PendingRow }) {
  const { t } = useTranslation();
  const now = useNow(15_000);
  const row = pendingPaymentRow(pending, now);
  if (!row) return null;
  // The amount in its own unit: a USDT payment is "20.00 USDT", never a rupee figure.
  let amount: string | null = null;
  if (pending.usdtMinor !== null) amount = amountText(pending.usdtMinor, "USDT");
  else if (row.amountInr !== null) amount = money(row.amountInr, "INR", { trim: true });
  return (
    <Pressable
      testID="payments-pending"
      accessibilityRole="button"
      accessibilityLabel={[t("payments.inProgress"), amount, t("payments.continue")].filter(Boolean).join(", ")}
      onPress={() => router.push({ pathname: "/payments/pay/[token]", params: { token: row.token } })}
      style={({ pressed }) => ({ minHeight: 66, flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 14, borderWidth: 1, borderColor: color.ruleSoft, backgroundColor: color.surface, opacity: pressed ? 0.85 : 1 })}
    >
      <IconTile size={36} icon="timer" />
      <View style={{ flex: 1 }}>
        <Txt size={15} weight={600} numberOfLines={2}>
          {t("payments.inProgress")}
        </Txt>
        {amount ? <Money text={amount} size={13} weight={500} color={color.ink2} numberOfLines={1} /> : null}
      </View>
      <View style={{ flexShrink: 0, flexDirection: "row", alignItems: "center", gap: 4 }}>
        <Txt size={14} weight={600} color={color.accentText}>
          {t("payments.continue")}
        </Txt>
        <Icon name="chevron" size={14} color={color.accentText} />
      </View>
    </Pressable>
  );
}
