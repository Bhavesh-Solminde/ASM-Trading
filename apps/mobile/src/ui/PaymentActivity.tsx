import { useQuery } from "@tanstack/react-query";
import { PaymentsPageSchema } from "@asm/contracts";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { api } from "@/api/client";
import { useSession } from "@/auth/session-store";
import { Button, Skeleton, Txt } from "@/theme/ui";
import { color } from "@/theme/tokens";
import { money } from "@/money/format";
import { Icon } from "./Icon";
export function PaymentActivity() {
  const { t } = useTranslation();
  const token = useSession(s => s.token);
  const query = useQuery({ queryKey: ["payments"], queryFn: () => api("/api/v1/payments?limit=20", { schema: PaymentsPageSchema }), enabled: !!token });
  if (query.isPending) return <Skeleton height={80} />;
  if (query.isError) return <Button label={t("common.retry")} kind="secondary" onPress={() => void query.refetch()} />;
  return <View>{query.data.rows.length === 0 ? <Txt color={color.ink2} style={{ paddingVertical: 24 }}>{t("redesign.noPayments")}</Txt> : query.data.rows.map(row => <View key={row.key} style={{ minHeight: 82, flexDirection: "row", alignItems: "center", gap: 12, borderBottomWidth: 1, borderBottomColor: color.rule }}>
    <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: color.raised, alignItems: "center", justifyContent: "center" }}><Icon name={row.kind === "deposit" ? "plus" : "arrowUp"} size={20} color={color.ink2} /></View>
    <View style={{ flex: 1 }}><Txt size={15} weight={500}>{t(`history.title.${row.kind}`)}</Txt><Txt size={11} color={color.ink2}>{row.methodLabel} · {t(`pay.status.${row.status}`)}</Txt></View>
    <Txt size={14} weight={600} color={row.kind === "deposit" && row.status === "COMPLETED" ? color.up : color.ink}>{money(row.amountMinor, row.currency)}</Txt>
  </View>)}</View>;
}
