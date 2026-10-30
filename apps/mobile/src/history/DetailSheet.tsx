import * as Clipboard from "expo-clipboard";
import { useEffect, useRef } from "react";
import { Pressable, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { PaymentRow } from "@asm/client-core";
import { ApiError } from "@/api/errors";
import { cachedPaymentRow, usePayment } from "@/api/queries";
import { useSessionLive } from "@/auth/use-session-live";
import { money } from "@/money/format";
import { statusTagTone } from "@/payments/status-tone";
import { useCancelWithdrawal } from "@/payments/useCancelWithdrawal";
import { color } from "@/theme/tokens";
import { Button, Txt } from "@/theme/ui";
import { Icon } from "@/ui/Icon";
import { KeyValueBox, type KeyValueRow } from "@/ui/KeyValueBox";
import { ListState } from "@/ui/ListState";
import { Money } from "@/ui/Money";
import { Sheet, type SheetRef } from "@/ui/Sheet";
import { StatusTag } from "@/ui/StatusTag";
import { toast } from "@/ui/Toast";
import { detailModel } from "./detail-model";
import { whenText } from "./format";
import { Timeline } from "./Timeline";

/** The reference, with a 44pt copy button: the string a customer quotes to support. */
function ReferenceValue({ reference }: { reference: string }) {
  const { t } = useTranslation();
  const copy = async () => {
    try {
      await Clipboard.setStringAsync(reference);
      toast(t("history.detail.referenceCopied"), "up");
    } catch {
      toast(t("common.genericError"), "down");
    }
  };
  return (
    <Pressable
      testID="payment-copy-reference"
      accessibilityRole="button"
      accessibilityLabel={t("history.detail.copyReference", { reference })}
      onPress={() => void copy()}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      style={{ minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 8 }}
    >
      <Txt size={14} weight={600} font="fig" color={color.ink}>{reference}</Txt>
      <Icon name="copy" size={16} color={color.ink2} />
    </Pressable>
  );
}

/** The sheet's content for one loaded payment. Mounted only while the sheet is presented (the `Sheet` rule). */
function PaymentDetailBody({ row }: { row: PaymentRow }) {
  const { t } = useTranslation();
  const nowMs = Date.now();
  const model = detailModel(row, nowMs);
  const { cancellingId, confirmCancel } = useCancelWithdrawal(row.currency, row.kind === "withdrawal" ? [row] : []);
  const status = t(`pay.status.${row.status}`);
  const what = t(row.kind === "deposit" ? "history.detail.depositVia" : "history.detail.withdrawalVia", { method: row.methodLabel });
  const amount = `${model.sign}${money(row.amountMinor, row.currency)}`;
  const busy = cancellingId === row.id;

  const rows: KeyValueRow[] = [
    { key: "reference", label: t("history.detail.reference"), value: <ReferenceValue reference={model.reference} /> },
    { key: "created", label: t("history.detail.created"), value: whenText(t, Date.parse(row.createdAt), nowMs) },
    ...(model.confirmedAtMs !== null ? [{ key: "confirmed", label: t("history.detail.confirmed"), value: whenText(t, model.confirmedAtMs, nowMs) }] : []),
    ...(model.holdUntilMs !== null ? [{ key: "hold", label: t("history.detail.holdUntil"), value: whenText(t, model.holdUntilMs, nowMs) }] : []),
    { key: "method", label: t("history.detail.method"), value: row.methodLabel },
    ...(row.destination ? [{ key: "to", label: t("history.detail.to"), value: row.destination }] : []),
    { key: "account", label: t("history.detail.account"), value: t("history.detail.accountValue", { currency: row.currency }) },
  ];

  return (
    <View testID={`payment-detail-${row.key}`} style={{ gap: 16 }}>
      <View style={{ gap: 6 }}>
        <StatusTag tone={statusTagTone(row.status)} label={status} testID="payment-detail-status" />
        <Money text={amount} size={36} weight={600} color={color[model.tone]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6} style={{ width: "100%" }} />
        <Txt size={16} color={color.ink2}>{t("history.detail.subtitle", { what, account: t("history.detail.liveAccount") })}</Txt>
      </View>
      <KeyValueBox rows={rows} tone="raised" />
      <Txt size={18} weight={600} accessibilityRole="header">{t("history.detail.timeline")}</Txt>
      <Timeline kind={row.kind} status={row.status} />
      {model.canCancel ? (
        <Button testID="payment-cancel" kind="secondary" label={t("withdraw.cancelYes")} busy={busy} disabled={cancellingId !== null} onPress={() => confirmCancel(row.id, row.amountMinor)} />
      ) : null}
    </View>
  );
}

/**
 * Loads the payment for `paymentKey`. The row from the loaded list (read from the cache, never subscribed to) shows at
 * once and the server's fresh one replaces it; if the refresh fails the list's row stays, with a Retry under it.
 */
function PaymentDetail({ paymentKey }: { paymentKey: string }) {
  const { t } = useTranslation();
  const live = useSessionLive();
  const cached = cachedPaymentRow(paymentKey);
  const query = usePayment(paymentKey, live, cached);
  const notFound = query.error instanceof ApiError && query.error.status === 404;
  const row = query.data ?? (query.isError && !notFound ? cached : undefined);
  if (row) {
    return (
      <View style={{ gap: 16 }}>
        <PaymentDetailBody row={row} />
        {query.isError ? <ListState loading={false} error onRetry={() => void query.refetch()} /> : null}
      </View>
    );
  }
  if (notFound) {
    return (
      <View testID="payment-detail-missing" style={{ gap: 8, paddingVertical: 24 }}>
        <Txt size={16} weight={600} accessibilityLiveRegion="polite">{t("pay.notFound")}</Txt>
      </View>
    );
  }
  return <ListState loading={query.isPending} error={query.isError} onRetry={() => void query.refetch()} rows={4} />;
}

/**
 * The payment detail sheet over History. The screen owns which payment is open (`paymentKey`, null = closed) and clears
 * it on `onClose`, so the same deep link can open the sheet again. The sheet presents when a key arrives; its content
 * (and the payment query) exists only while it is up.
 */
export function DetailSheet({ paymentKey, onClose }: { paymentKey: string | null; onClose: () => void }) {
  const { t } = useTranslation();
  const sheet = useRef<SheetRef>(null);
  useEffect(() => {
    if (paymentKey !== null) sheet.current?.present();
  }, [paymentKey]);
  return (
    <Sheet ref={sheet} title={t("history.detail.title")} snapPoints={["88%"]} scroll onDismiss={onClose}>
      {paymentKey !== null ? <PaymentDetail paymentKey={paymentKey} /> : null}
    </Sheet>
  );
}
