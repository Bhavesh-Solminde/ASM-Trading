import { router } from "expo-router";
import { Pressable, View } from "react-native";
import { useTranslation } from "react-i18next";
import { usePaymentsInfinite } from "@/api/queries";
import { useSessionLive } from "@/auth/use-session-live";
import { paymentRows } from "@/api/payment-rows";
import { paymentFigure } from "@/payments/payment-figure";
import { statusTagTone } from "@/payments/status-tone";
import { Txt } from "@/theme/ui";
import { color } from "@/theme/tokens";
import { money } from "@/money/format";
import { IconTile } from "./IconTile";
import { ListState } from "./ListState";
import { StatusTag } from "./StatusTag";

/**
 * Deposit and withdrawal rows from the shared infinite payments query; `limit` caps the rows (the Payments preview).
 * A row opens that payment in History (`/history?tx=<key>`). The status is a tag; the amount carries its sign and ink
 * from `paymentFigure` and never shrinks.
 */
export function PaymentActivity({ limit }: { limit?: number } = {}) {
  const { t } = useTranslation();
  const query = usePaymentsInfinite(useSessionLive());
  const rows = paymentRows(query.data, limit);
  return (
    <View>
      <ListState loading={query.isPending} error={query.isError} empty={!query.isPending && !query.isError && rows.length === 0 ? t("redesign.noPayments") : undefined} onRetry={() => void query.refetch()} />
      {rows.map((row) => {
        const figure = paymentFigure(row);
        const status = t(`pay.status.${row.status}`);
        const amount = `${figure.sign}${money(row.amountMinor, row.currency)}`;
        const title = t(`history.title.${row.kind}`);
        return (
          <Pressable
            key={row.key}
            testID={`payment-row-${row.key}`}
            accessibilityRole="button"
            accessibilityLabel={`${title}, ${row.methodLabel}, ${amount}, ${status}`}
            onPress={() => router.push({ pathname: "/history", params: { tx: row.key } })}
            style={({ pressed }) => ({ minHeight: 66, flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: color.rule, opacity: pressed ? 0.85 : 1 })}
          >
            <IconTile size={36} icon={row.kind === "deposit" ? "plus" : "arrowUp"} />
            <View style={{ flex: 1 }}>
              <Txt size={15} weight={500}>{title}</Txt>
              <Txt size={12} color={color.ink2} numberOfLines={1}>{row.methodLabel}</Txt>
            </View>
            <View style={{ flexShrink: 0, maxWidth: "55%", alignItems: "flex-end", gap: 4 }}>
              <Txt size={14} weight={600} numberOfLines={1} color={color[figure.tone]} style={{ flexShrink: 0 }}>{amount}</Txt>
              <StatusTag tone={statusTagTone(row.status)} label={status} align="flex-end" />
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}
