import { router } from "expo-router";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { CheckoutView } from "@asm/contracts";
import { money } from "@/money/format";
import { color } from "@/theme/tokens";
import { Button, Txt } from "@/theme/ui";
import { Money } from "@/ui/Money";
import { StatusTag } from "@/ui/StatusTag";
import { statusTagTone } from "./status-tone";

/**
 * A payment that has ended: credited, rejected or expired. T3a ships this plain frame so the pay screen always has
 * somewhere to land; T3b replaces it with the receipt (credited amount, bonus, UTR, date, share).
 */
export function PayResult({ view }: { view: CheckoutView }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  return (
    <View testID="pay-result" style={{ gap: 20, paddingBottom: 16 + insets.bottom }}>
      <StatusTag tone={statusTagTone(view.status)} label={t(`pay.status.${view.status}`)} />
      <View style={{ width: "100%" }}>
        <Money text={money(view.amountInr, "INR")} size={36} weight={600} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6} />
      </View>
      <Txt size={15} color={color.ink2}>
        {t(`pay.resultNote.${view.status}`)}
      </Txt>
      <Button testID="pay-result-done" kind="light" label={t("pay.backToPayments")} onPress={() => router.replace("/payments")} />
    </View>
  );
}
