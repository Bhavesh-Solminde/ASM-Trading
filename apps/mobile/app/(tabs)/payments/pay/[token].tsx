import { router, useLocalSearchParams } from "expo-router";
import { ScrollView, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ApiError } from "@/api/errors";
import { money } from "@/money/format";
import { ExpiryClock } from "@/payments/ExpiryClock";
import { PayResult } from "@/payments/PayResult";
import { isFinalStatus } from "@/payments/checkout-poll";
import { UpiPay } from "@/payments/UpiPay";
import { usePayCheckout } from "@/payments/usePayCheckout";
import { color } from "@/theme/tokens";
import { Button, Screen, Skeleton, Txt } from "@/theme/ui";
import { BackHeader } from "@/ui/BackHeader";

/**
 * `/payments/pay/<checkout token>`: pay a deposit. The checkout is polled every 4s while this screen is in front
 * (`usePayCheckout`), and when it ends (credited, rejected, expired) the result takes the place of the payment.
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
  const open = !!view && !isFinalStatus(view.status);
  const title = view ? t("pay.title", { amount: money(view.amountInr, "INR", { trim: true }) }) : t("pay.heading");

  let body;
  if (view && !open) {
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
  } else if (view) {
    body = <UpiPay view={view} token={checkoutToken} />;
  } else if (checkout.isError) {
    const gone = checkout.error instanceof ApiError && checkout.error.status === 404;
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
      <ScrollView testID="pay-screen" contentContainerStyle={{ padding: 20, paddingBottom: 20 + insets.bottom, gap: 20 }} keyboardShouldPersistTaps="handled">
        <BackHeader title={title} icon="close" aside={open && Number.isFinite(expiresAtMs) ? <ExpiryClock expiresAtMs={expiresAtMs} /> : undefined} />
        {body}
      </ScrollView>
    </Screen>
  );
}
