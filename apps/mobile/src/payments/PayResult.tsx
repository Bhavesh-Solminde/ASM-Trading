import { router } from "expo-router";
import { Share, View } from "react-native";
import { useTranslation } from "react-i18next";
import { referenceFor } from "@asm/client-core";
import type { CheckoutView } from "@asm/contracts";
import { money } from "@/money/format";
import { color } from "@/theme/tokens";
import { Button, Txt } from "@/theme/ui";
import { Icon } from "@/ui/Icon";
import { KeyValueBox, type KeyValueRow } from "@/ui/KeyValueBox";
import { Money } from "@/ui/Money";
import { StatusTag } from "@/ui/StatusTag";
import { toast } from "@/ui/Toast";
import { methodLabel, receiptModel, receiptShareText } from "./receipt-model";
import { amountText, endedNoteKey, endedUsdtLink, requestedAmount, showsSupportLink } from "./result-model";
import { statusTagTone } from "./status-tone";

/** A 64 round mark: the green check of a credit, or the `raised` cross of one that ended without money. */
function Mark({ ok }: { ok: boolean }) {
  return (
    <View style={{ width: 64, height: 64, borderRadius: 32, alignItems: "center", justifyContent: "center", backgroundColor: ok ? color.up : color.raised }}>
      <Icon name={ok ? "check" : "close"} size={32} color={ok ? color.upInk : color.downText} strokeWidth={ok ? 2.5 : 2} />
    </View>
  );
}

/** The amount, fitted to one line across the full width. */
function BigAmount({ text }: { text: string }) {
  return (
    <View style={{ width: "100%" }}>
      <Money text={text} size={40} weight={600} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6} lineHeight={48} style={{ textAlign: "center" }} />
    </View>
  );
}

/**
 * COMPLETED: "Payment confirmed" and the receipt: the credit, then Method / Status / Reference / Bonus / UTR / Date,
 * the balance after it, "Start trading" and "Share receipt". Every row the server did not send is simply absent (an
 * older server sends none of them), and the bonus shows, in gold, only when it is above zero.
 */
function Receipt({ view }: { view: CheckoutView }) {
  const { t } = useTranslation();
  const model = receiptModel(view, { tzOffsetMin: -new Date().getTimezoneOffset() });
  const rows: KeyValueRow[] = [
    { key: "method", label: t("pay.receipt.method"), value: model.method, testID: "receipt-method" },
    { key: "status", label: t("pay.receipt.status"), value: <StatusTag tone={statusTagTone(view.status)} label={t(`pay.status.${view.status}`)} align="flex-end" />, testID: "receipt-status" },
    { key: "reference", label: t("pay.receipt.reference"), value: model.reference, font: "fig", testID: "receipt-reference" },
  ];
  if (model.bonusMinor !== null) {
    rows.push({ key: "bonus", label: t("pay.receipt.bonus"), value: `+${money(model.bonusMinor, model.currency)}`, valueColor: color.gold, testID: "receipt-bonus" });
  }
  if (model.utr !== null) rows.push({ key: "utr", label: t("pay.receipt.utr"), value: model.utr, font: "fig", testID: "receipt-utr" });
  if (model.dateText !== null) rows.push({ key: "date", label: t("pay.receipt.date"), value: model.dateText, font: "fig", testID: "receipt-date" });

  const share = async () => {
    const message = receiptShareText(model, {
      title: t("pay.receipt.shareTitle"),
      amount: t("pay.receipt.amount"),
      bonus: t("pay.receipt.bonus"),
      method: t("pay.receipt.paidWith"),
      utr: t("pay.receipt.utr"),
      date: t("pay.receipt.date"),
      reference: t("pay.receipt.reference"),
    });
    try {
      await Share.share({ message });
    } catch {
      toast(t("pay.receipt.shareFailed"), "down");
    }
  };

  return (
    <View testID="pay-result" style={{ flexGrow: 1, gap: 20 }}>
      <View style={{ alignItems: "center", gap: 14, paddingTop: 12 }}>
        <Mark ok />
        <Txt testID="receipt-title" size={28} weight={600} style={{ textAlign: "center" }}>
          {t("pay.receipt.moneyAdded")}
        </Txt>
        <BigAmount text={amountText(model.amountMinor, model.currency)} />
        <Txt size={14} color={color.ink2} style={{ textAlign: "center" }}>
          {t("pay.receipt.balanceUpdated")}
        </Txt>
      </View>
      <KeyValueBox rows={rows} />
      {model.balanceAfterMinor !== null ? (
        <KeyValueBox
          rows={[{ key: "balance", label: t("pay.receipt.newBalance"), value: <Money text={money(model.balanceAfterMinor, model.currency)} size={17} weight={600} numberOfLines={1} />, testID: "receipt-balance" }]}
        />
      ) : null}
      <View style={{ flexGrow: 1, minHeight: 8 }} />
      <View style={{ gap: 12 }}>
        <Button testID="pay-start-trading" kind="light" label={t("pay.receipt.startTrading")} onPress={() => router.navigate("/trade")} />
        <Button testID="pay-share-receipt" kind="secondary" label={t("pay.receipt.share")} onPress={() => void share()} />
      </View>
    </View>
  );
}

/**
 * REJECTED / EXPIRED: the same frame without the credit. A `down` tag, the amount that was asked for, the website's
 * copy and "New deposit". There is no UTR link here (the UTR claim takes only an open payment); an expired manual
 * USDT deposit still takes a transaction hash, so it offers that (a gateway one, support), and a rejection offers support. An expired payment says plainly that a payment already sent is still credited and must not be sent again.
 */
function Ended({ view, token }: { view: CheckoutView; token: string }) {
  const { t } = useTranslation();
  const rejected = view.status === "REJECTED";
  const asked = requestedAmount(view);
  const usdtLink = endedUsdtLink(view);
  return (
    <View testID="pay-result" style={{ flexGrow: 1, gap: 20 }}>
      <View style={{ alignItems: "center", gap: 14, paddingTop: 12 }}>
        <Mark ok={false} />
        <Txt testID="ended-title" size={28} weight={600} style={{ textAlign: "center" }}>
          {t(rejected ? "pay.ended.rejectedTitle" : "pay.ended.expiredTitle")}
        </Txt>
        <BigAmount text={amountText(asked.minor, asked.currency)} />
        <Txt testID="ended-note" size={14} color={color.ink2} style={{ textAlign: "center" }}>
          {t(endedNoteKey({ status: view.status, isGateway: view.isGateway }))}
        </Txt>
      </View>
      <KeyValueBox
        rows={[
          { key: "method", label: t("pay.receipt.method"), value: methodLabel(view.method) },
          { key: "status", label: t("pay.receipt.status"), value: <StatusTag tone={statusTagTone(view.status)} label={t(`pay.status.${view.status}`)} align="flex-end" />, testID: "ended-status" },
          { key: "reference", label: t("pay.receipt.reference"), value: referenceFor({ kind: "deposit", id: view.id }), font: "fig" },
        ]}
      />
      <View style={{ flexGrow: 1, minHeight: 8 }} />
      <View style={{ gap: 12 }}>
        <Button testID="pay-new-deposit" kind="light" label={t("pay.ended.newDeposit")} onPress={() => router.replace("/payments/deposit")} />
        {usdtLink === "claim" ? (
          <Button
            testID="pay-claim"
            kind="text"
            label={t("usdt.endedClaim")}
            onPress={() => router.push({ pathname: "/payments/claim/[id]", params: { id: view.id, kind: "usdt", token } })}
          />
        ) : null}
        {usdtLink === "support" ? <Button testID="pay-contact-support" kind="text" label={t("usdt.endedSupport")} onPress={() => router.push("/account/support")} /> : null}
        {showsSupportLink(view.status) ? <Button testID="pay-contact-support" kind="text" label={t("pay.ended.contactSupport")} onPress={() => router.push("/account/support")} /> : null}
      </View>
    </View>
  );
}

/** A payment that has ended: the receipt when it was credited, the ended frame when it was rejected or expired. */
export function PayResult({ view, token }: { view: CheckoutView; token: string }) {
  return view.status === "COMPLETED" ? <Receipt view={view} /> : <Ended view={view} token={token} />;
}
