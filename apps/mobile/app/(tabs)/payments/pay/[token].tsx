import { router, useLocalSearchParams } from "expo-router";
import { ScrollView, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ApiError } from "@/api/errors";
import { money } from "@/money/format";
import { ExpiryClock } from "@/payments/ExpiryClock";
import { PayPending } from "@/payments/PayPending";
import { PayResult } from "@/payments/PayResult";
import { payScreenFor } from "@/payments/result-model";
import { UpiPay } from "@/payments/UpiPay";
import { usePayCheckout } from "@/payments/usePayCheckout";
import { color } from "@/theme/tokens";
import { Button, Screen, Skeleton, Txt } from "@/theme/ui";
import { BackHeader } from "@/ui/BackHeader";

/**
 * `/payments/pay/<checkout token>`: pay a deposit. The checkout is polled every 4s while this screen is in front
 * (`usePayCheckout`), and what it draws follows the status (`payScreenFor`): the way to pay, "checking your payment"
 * once the UTR is in, then the receipt (credited) or the ended frame (rejected, expired).
 * UPI payments are drawn here (T3a); a USDT payment's screen is T4's, so it shows a plain notice until then.
 */
export default function Pay() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { token } = useLocalSearchParams<{ token: string }>();
  const checkoutToken = typeof token === "string" ? token : "";
  const checkout = usePayCheckout(checkoutToken);
  const view = checkout.data;
  const expiresAtMs = view ? Date.parse(view.expiresAt) : Number.NaN;
  const screen = view ? payScreenFor(view.status) : null;
  // The way to pay keeps its close button and clock; the frames after it are a destination, so a back arrow to Payments.
  const paying = screen === "pay";
  let title = t("pay.heading");
  if (view) title = paying ? t("pay.title", { amount: money(view.amountInr, "INR", { trim: true }) }) : t(screen === "receipt" ? "pay.confirmedTitle" : "pay.statusTitle");

  let body;
  if (view && (screen === "receipt" || screen === "ended")) {
    body = <PayResult view={view} />;
  } else if (view && view.method === "USDT") {
    // T4 draws the address, QR and tx-hash claim. Until then say so rather than show a blank screen.
    body = (
      <View style={{ gap: 16 }}>
        <Txt testID="pay-usdt-soon" size={15} color={color.ink2}>
          {t("pay.usdtSoon")}
        </Txt>
        <Button kind="light" label={t("pay.backToPayments")} onPress={() => router.replace("/payments")} />
      </View>
    );
  } else if (view && screen === "pending") {
    body = <PayPending view={view} />;
  } else if (view) {
    body = <UpiPay view={view} token={checkoutToken} />;
  } else if (checkout.isError || checkoutToken === "") {
    // No token in the link reads as a payment that does not exist (the query stays off without one).
    const gone = checkoutToken === "" || (checkout.error instanceof ApiError && checkout.error.status === 404);
    body = (
      <View style={{ gap: 12 }}>
        <Txt color={color.ink2}>{gone ? t("pay.notFound") : t("common.genericError")}</Txt>
        {gone ? (
          <Button kind="light" label={t("pay.backToPayments")} onPress={() => router.replace("/payments")} />
        ) : (
          <Button label={t("common.retry")} kind="secondary" onPress={() => void checkout.refetch()} />
        )}
      </View>
    );
  } else {
    body = (
      <View accessibilityRole="progressbar" accessibilityLabel={t("common.loading")} style={{ gap: 12 }}>
        <Skeleton height={196} />
        <Skeleton height={54} />
        <Skeleton height={56} />
      </View>
    );
  }

  return (
    <Screen>
      <ScrollView testID="pay-screen" contentContainerStyle={{ flexGrow: 1, padding: 20, paddingBottom: 20 + insets.bottom, gap: 20 }} keyboardShouldPersistTaps="handled">
        <BackHeader
          title={title}
          icon={paying || !view ? "close" : "arrowLeft"}
          onBack={paying || !view ? undefined : () => router.replace("/payments")}
          aside={paying && Number.isFinite(expiresAtMs) ? <ExpiryClock expiresAtMs={expiresAtMs} /> : undefined}
        />
        {body}
      </ScrollView>
    </Screen>
  );
}
