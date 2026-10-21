import { router } from "expo-router";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import type { CheckoutView } from "@asm/contracts";
import { money } from "@/money/format";
import { color } from "@/theme/tokens";
import { Button, Txt } from "@/theme/ui";
import { Icon } from "@/ui/Icon";
import { KeyValueBox, type KeyValueRow } from "@/ui/KeyValueBox";
import { StatusTag } from "@/ui/StatusTag";
import { statusTagTone } from "./status-tone";

/**
 * "Checking your payment": the UTR is in and we are confirming. Pending reads as pending, never as success, and it says
 * not to pay again (a second payment could never be matched). The user may leave: Payments keeps showing the payment
 * as in progress, and the screen flips to the receipt by itself when it lands.
 */
export function PayPending({ view }: { view: CheckoutView }) {
  const { t } = useTranslation();
  const rows: KeyValueRow[] = [
    { key: "amount", label: t("pay.pending.amount"), value: money(view.amountInr, "INR") },
    { key: "status", label: t("pay.receipt.status"), value: <StatusTag tone={statusTagTone(view.status)} label={t(`pay.status.${view.status}`)} align="flex-end" />, testID: "pending-status" },
  ];
  if (view.claimedUtr) rows.push({ key: "utr", label: t("pay.receipt.utr"), value: view.claimedUtr, font: "fig" });
  return (
    <View testID="pay-pending" style={{ flexGrow: 1, gap: 20 }}>
      <View style={{ alignItems: "center", gap: 14, paddingTop: 36 }}>
        <Icon name="history" size={44} color={color.accentText} strokeWidth={1.75} />
        <Txt testID="pending-title" accessibilityLiveRegion="polite" size={28} weight={600} style={{ textAlign: "center" }}>
          {t("pay.pending.title")}
        </Txt>
        <Txt size={14} color={color.ink2} style={{ textAlign: "center" }}>
          {t("pay.pending.body")}
        </Txt>
        <Txt testID="pay-no-second-payment" size={14} weight={600} style={{ textAlign: "center" }}>
          {t("pay.dontPayAgain")}
        </Txt>
      </View>
      <KeyValueBox rows={rows} />
      <View style={{ flexGrow: 1, minHeight: 8 }} />
      <View style={{ gap: 12 }}>
        <Button testID="pay-pending-done" kind="light" label={t("pay.pending.goPayments")} onPress={() => router.replace("/payments")} />
        <Button
          testID="pay-pending-details"
          kind="secondary"
          label={t("pay.pending.viewDetails")}
          onPress={() => router.push({ pathname: "/history", params: { filter: "payments", tx: `d:${view.id}` } })}
        />
      </View>
    </View>
  );
}
