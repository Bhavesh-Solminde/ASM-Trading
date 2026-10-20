import { useState } from "react";
import { ScrollView, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useBootstrap } from "@/api/queries";
import { useSession } from "@/auth/session-store";
import { Screen, Txt, Button, Skeleton } from "@/theme/ui";
import { useUserPrefs } from "@/trade/trade-prefs";
import { resolveAccount } from "@/trade/accounts";
import { useAccountTradesLoaded } from "@/trade/useAccountTrades";
import { TradesBody } from "@/trade/TradesSheet";
import { Chip } from "@/ui/Chip";
import { PaymentActivity } from "@/ui/PaymentActivity";
export default function History() {
  const { t } = useTranslation();
  const token = useSession(s => s.token);
  const query = useBootstrap(!!token);
  const boot = query.data;
  const prefs = useUserPrefs(boot?.userId ?? null);
  const account = boot ? resolveAccount(boot.accounts, prefs.accountId, boot.liveAccess) : undefined;
  const loaded = useAccountTradesLoaded(account?.id ?? "", !!account);
  const [tab, setTab] = useState<"trades" | "payments">("trades");
  return <Screen><ScrollView contentContainerStyle={{ paddingTop: 20, paddingBottom: 24, gap: 24 }}>
    <Txt size={28} weight={600} accessibilityRole="header" style={{ paddingHorizontal: 20 }}>{t("redesign.activity")}</Txt>
    <View style={{ flexDirection: "row", gap: 10, paddingHorizontal: 20 }}>
      <Chip label={t("tabs.trade")} selected={tab === "trades"} onPress={() => setTab("trades")} />
      <Chip label={t("tabs.payments")} selected={tab === "payments"} onPress={() => setTab("payments")} />
    </View>
    {tab === "payments" ? <View style={{ paddingHorizontal: 20 }}><PaymentActivity /></View> : boot && account ? <TradesBody accountId={account.id} accountType={account.type} assets={boot.assets} currency={account.currency} listLoaded={loaded} /> : query.isError ? <Button label={t("common.retry")} onPress={() => void query.refetch()} /> : <Skeleton height={100} />}
  </ScrollView></Screen>;
}
