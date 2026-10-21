import { useState } from "react";
import { ScrollView, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useBootstrap } from "@/api/queries";
import { useSession } from "@/auth/session-store";
import { Screen, Txt, Button, Skeleton } from "@/theme/ui";
import { useUserPrefs } from "@/trade/trade-prefs";
import { bootstrapTradesAccountId, resolveAccount } from "@/trade/accounts";
import { listLoadedFor, useListLoaded } from "@/trade/list-loaded-store";
import { TradesBody } from "@/trade/TradesSheet";
import { useAccountTradesLoaded } from "@/trade/useAccountTrades";
import { Chip } from "@/ui/Chip";
import { PaymentActivity } from "@/ui/PaymentActivity";
export default function History() {
  const { t } = useTranslation();
  const token = useSession(s => s.token);
  const query = useBootstrap(!!token);
  const boot = query.data;
  const prefs = useUserPrefs(boot?.userId ?? null);
  const account = boot ? resolveAccount(boot.accounts, prefs.accountId, boot.liveAccess) : undefined;
  // Trade owns the trade-list fetch and publishes which account is complete; History only reads it.
  const loadedFor = useListLoaded((s) => s.loadedFor);
  const loadedByTrade = listLoadedFor(loadedFor, account?.id, boot ? bootstrapTradesAccountId(boot.accounts) : undefined);
  // Opened straight from a link before Trade ever mounted: fetch this account's list here, once, rather than
  // showing the skeleton until the user visits Trade. Once Trade has published, this does nothing.
  const loadedHere = useAccountTradesLoaded(account?.id ?? "", !!account && !loadedByTrade);
  const loaded = loadedByTrade || loadedHere;
  const [tab, setTab] = useState<"trades" | "payments">("trades");
  return <Screen><ScrollView contentContainerStyle={{ paddingTop: 20, paddingBottom: 24, gap: 24 }}>
    <Txt size={28} weight={600} accessibilityRole="header" style={{ paddingHorizontal: 20 }}>{t("redesign.activity")}</Txt>
    <View style={{ flexDirection: "row", gap: 10, paddingHorizontal: 20 }}>
      <Chip label={t("tabs.trade")} selected={tab === "trades"} onPress={() => setTab("trades")} />
      <Chip label={t("tabs.payments")} selected={tab === "payments"} onPress={() => setTab("payments")} />
    </View>
    {tab === "payments" ? <View style={{ paddingHorizontal: 20 }}><PaymentActivity /></View> : boot && account ? <TradesBody accountId={account.id} accountType={account.type} assets={boot.assets} currency={account.currency} listLoaded={loaded} loadingWhenEmpty /> : query.isError ? <Button label={t("common.retry")} onPress={() => void query.refetch()} /> : <Skeleton height={100} />}
  </ScrollView></Screen>;
}
