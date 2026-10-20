import { router } from "expo-router";
import { ScrollView, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useBootstrap, useWallet } from "@/api/queries";
import { useSession } from "@/auth/session-store";
import { useSessionLive } from "@/auth/use-session-live";
import { Button, Card, Screen, Skeleton, Txt } from "@/theme/ui";
import { color } from "@/theme/tokens";
import { money } from "@/money/format";
import { PaymentActivity } from "@/ui/PaymentActivity";
export default function Payments() {
  const { t } = useTranslation();
  const token = useSession(s => s.token);
  const boot = useBootstrap(!!token).data;
  const wallet = useWallet(useSessionLive());
  const live = wallet.data?.accounts.find(a => a.type === "LIVE");
  return <Screen><ScrollView contentContainerStyle={{ padding: 20, gap: 28 }}>
    <Txt size={28} weight={600} accessibilityRole="header">{t("redesign.yourMoney")}</Txt>
    <View style={{ gap: 12 }}>
      <Txt size={13} color={color.up}>{t("trade.liveAccount")}</Txt>
      {wallet.isError ? <Button label={t("common.retry")} kind="secondary" onPress={() => void wallet.refetch()} /> : wallet.isPending ? <Skeleton height={52} /> : <Txt size={40} weight={500} numberOfLines={1} adjustsFontSizeToFit>{live ? money(live.realBalance + live.bonusBalance, live.currency) : "—"}</Txt>}
      {live && wallet.data ? <View style={{ flexDirection: "row", gap: 12 }}><View style={{ flex: 1 }}><Txt size={12} color={color.ink2} numberOfLines={1}>{t("redesign.withdrawable")} {money(wallet.data.withdrawable, live.currency)}</Txt></View><View style={{ flex: 1 }}><Txt size={12} color={color.gold} numberOfLines={1} style={{ textAlign: "right" }}>{t("redesign.bonus")} {money(wallet.data.lockedBonus, live.currency)}</Txt></View></View> : null}
    </View>
    <View style={{ flexDirection: "row", gap: 12 }}><View style={{ flex: 1 }}><Button label={t("history.title.withdrawal")} kind="secondary" onPress={() => router.push("/payments/withdraw")} /></View><View style={{ flex: 1 }}><Button label={t("redesign.addMoney")} kind="light" onPress={() => router.push("/payments/deposit")} /></View></View>
    {boot && boot.profile.kycStatus !== "VERIFIED" ? <Card><Txt size={12} color={color.accentText}>{t("redesign.nextStep")}</Txt><Txt size={20} weight={600} style={{ marginVertical: 8 }}>{t("redesign.verify")}</Txt><Button label={t("redesign.verify")} kind="text" onPress={() => router.push("/account/verify")} /></Card> : null}
    <View><Txt size={20} weight={600}>{t("redesign.recentActivity")}</Txt><PaymentActivity /></View>
  </ScrollView></Screen>;
}
