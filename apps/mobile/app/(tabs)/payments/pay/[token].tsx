import { router, useLocalSearchParams } from "expo-router";
import { ScrollView, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ApiError } from "@/api/errors";
import { ExpiryClock } from "@/payments/ExpiryClock";
import { PayPending } from "@/payments/PayPending";
import { PayResult } from "@/payments/PayResult";
import { payScreenFor, payTitleAmount } from "@/payments/result-model";
import { UpiPay } from "@/payments/UpiPay";
import { UsdtPay } from "@/payments/UsdtPay";
import { usePayCheckout } from "@/payments/usePayCheckout";
import { useUsdtProgress } from "@/payments/useUsdtProgress";
import { usdtClockShown } from "@/payments/usdt-progress";
import { color } from "@/theme/tokens";
import { Button, Screen, Skeleton, Txt } from "@/theme/ui";
import { BackHeader } from "@/ui/BackHeader";

/**
 * `/payments/pay/<checkout token>`: pay a deposit. The checkout is polled every 4s while this screen is in front
 * (`usePayCheckout`), and what it draws follows the status (`payScreenFor`): the way to pay, "checking your payment"
 * once the UTR is in, then the receipt (credited) or the ended frame (rejected, expired).
 * A UPI payment is drawn by `UpiPay`, a USDT payment by `UsdtPay` (its address, network warning and tx-hash claim).
 */
export default function Pay() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { token } = useLocalSearchParams<{ token: string }>();
  const checkoutToken = typeof token === "string" ? token : "";
  const checkout = usePayCheckout(checkoutToken);
  // The one place the USDT status route is polled; a transfer that has been seen also takes the clock away, as on the web.
  const { progress, lapsed } = useUsdtProgress(checkoutToken, checkout.data);
  // A USDT window that is over with nothing on its way is drawn as the ended frame while the server still says open (it
  // holds an unpaid manual or slot deposit for up to 48 h), so the address is never offered after the deadline.
  const view = checkout.data && lapsed ? { ...checkout.data, status: "EXPIRED" as const } : checkout.data;
  const expiresAtMs = view ? Date.parse(view.expiresAt) : Number.NaN;
  const screen = view ? payScreenFor(view.status) : null;
  // The way to pay keeps its close button and clock; the frames after it are a destination, so a back arrow to Payments.
  const paying = screen === "pay";
  let title = t("pay.heading");
  if (view) title = paying ? t("pay.title", { amount: payTitleAmount(view) }) : t(screen === "receipt" ? "pay.confirmedTitle" : "pay.statusTitle");

  let body;
  if (view && (screen === "receipt" || screen === "ended")) {
    body = <PayResult view={view} token={checkoutToken} />;
  } else if (view && view.method === "USDT") {
    // A USDT payment has no UTR to wait on, so even "processing" keeps its own screen (address, status, claim).
    body = <UsdtPay view={view} token={checkoutToken} progress={progress} />;
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
          aside={paying && usdtClockShown(progress) && Number.isFinite(expiresAtMs) ? <ExpiryClock expiresAtMs={expiresAtMs} /> : undefined}
        />
        {body}
      </ScrollView>
    </Screen>
  );
}
