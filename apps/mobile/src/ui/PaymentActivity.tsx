import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { usePaymentsInfinite } from "@/api/queries";
import { useSessionLive } from "@/auth/use-session-live";
import { paymentRows } from "@/api/payment-rows";
import { Button, Skeleton, Txt } from "@/theme/ui";
import { color } from "@/theme/tokens";
import { money } from "@/money/format";
import { Icon } from "./Icon";
/** Deposit and withdrawal rows from the shared infinite payments query; `limit` caps the rows (the Payments preview). */
export function PaymentActivity({ limit }: { limit?: number } = {}) {
  const { t } = useTranslation();
  const query = usePaymentsInfinite(useSessionLive());
  const rows = paymentRows(query.data, limit);
  if (query.isPending) return <Skeleton height={80} />;
  if (query.isError) return <Button label={t("common.retry")} kind="secondary" onPress={() => void query.refetch()} />;
  return <View>{rows.length === 0 ? <Txt color={color.ink2} style={{ paddingVertical: 24 }}>{t("redesign.noPayments")}</Txt> : rows.map(row => <View key={row.key} style={{ minHeight: 82, flexDirection: "row", alignItems: "center", gap: 12, borderBottomWidth: 1, borderBottomColor: color.rule }}>
    <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: color.raised, alignItems: "center", justifyContent: "center" }}><Icon name={row.kind === "deposit" ? "plus" : "arrowUp"} size={20} color={color.ink2} /></View>
    <View style={{ flex: 1 }}><Txt size={15} weight={500}>{t(`history.title.${row.kind}`)}</Txt><Txt size={11} color={color.ink2}>{row.methodLabel} · {t(`pay.status.${row.status}`)}</Txt></View>
    <Txt size={14} weight={600} style={{ flexShrink: 0 }} color={row.kind === "deposit" && row.status === "COMPLETED" ? color.up : color.ink}>{money(row.amountMinor, row.currency)}</Txt>
  </View>)}</View>;
}
