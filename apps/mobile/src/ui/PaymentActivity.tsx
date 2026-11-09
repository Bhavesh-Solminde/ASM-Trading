import { router } from "expo-router";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { usePaymentsInfinite } from "@/api/queries";
import { useSessionLive } from "@/auth/use-session-live";
import { paymentRows } from "@/api/payment-rows";
import { ListState } from "./ListState";
import { PaymentListRow } from "./PaymentListRow";

/**
 * Deposit and withdrawal rows from the shared infinite payments query; `limit` caps the rows (the Payments preview).
 * A row opens that payment in History (`/history?tx=<key>`).
 */
export function PaymentActivity({ limit }: { limit?: number } = {}) {
  const { t } = useTranslation();
  const query = usePaymentsInfinite(useSessionLive());
  const rows = paymentRows(query.data, limit);
  return (
    <View>
      <ListState loading={query.isPending} error={query.isError} empty={!query.isPending && !query.isError && rows.length === 0 ? t("redesign.noPayments") : undefined} onRetry={() => void query.refetch()} />
      {rows.map((row) => (
        <PaymentListRow key={row.key} row={row} testID={`payment-row-${row.key}`} onPress={() => router.push({ pathname: "/history", params: { tx: row.key } })} />
      ))}
    </View>
  );
}
