import { Pressable, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { PaymentRow } from "@asm/client-core";
import { money } from "@/money/format";
import { whenParts } from "@/history/when";
import { paymentFigure } from "@/payments/payment-figure";
import { statusTagTone } from "@/payments/status-tone";
import { color } from "@/theme/tokens";
import { Txt } from "@/theme/ui";
import { IconTile } from "./IconTile";
import { StatusTag } from "./StatusTag";

/**
 * One deposit or withdrawal as a list row (the Payments preview and the History list share it). The status is a tag;
 * the amount carries its sign and ink from `paymentFigure` and never shrinks. At least 66pt tall, so the whole row is the target.
 */
export function PaymentListRow({ row, onPress, testID, showTime = false }: { row: PaymentRow; onPress: () => void; testID: string; showTime?: boolean }) {
  const { t } = useTranslation();
  const figure = paymentFigure(row);
  const status = t(`pay.status.${row.status}`);
  const amount = `${figure.sign}${money(row.amountMinor, row.currency)}`;
  const title = t(`history.title.${row.kind}`);
  // History's day-grouped rows add the time of day, so several payments on one day can be told apart.
  const time = showTime ? whenParts(Date.parse(row.createdAt), Date.now()).time : null;
  const method = time === null ? row.methodLabel : `${row.methodLabel} · ${time}`;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${method}, ${amount}, ${status}`}
      onPress={onPress}
      style={({ pressed }) => ({ minHeight: 66, flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: color.rule, opacity: pressed ? 0.85 : 1 })}
    >
      <IconTile size={36} icon={row.kind === "deposit" ? "plus" : "arrowUp"} />
      <View style={{ flex: 1 }}>
        <Txt size={15} weight={500}>{title}</Txt>
        <Txt size={12} color={color.ink2} numberOfLines={1}>{method}</Txt>
      </View>
      <View style={{ flexShrink: 0, maxWidth: "55%", alignItems: "flex-end", gap: 4 }}>
        <Txt size={14} weight={600} numberOfLines={1} color={color[figure.tone]} style={{ flexShrink: 0 }}>{amount}</Txt>
        <StatusTag tone={statusTagTone(row.status)} label={status} align="flex-end" />
      </View>
    </Pressable>
  );
}
