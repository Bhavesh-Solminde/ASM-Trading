import { useLocalSearchParams, useNavigation } from "expo-router";
import { useEffect, useState } from "react";
import { ScrollView, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useBootstrap } from "@/api/queries";
import { useSession } from "@/auth/session-store";
import { DetailSheet } from "@/history/DetailSheet";
import { historyParams, type HistorySegment, type PaymentsFilter } from "@/history/history-params";
import { PaymentsList } from "@/history/PaymentsList";
import { Screen, Txt, Button, Skeleton } from "@/theme/ui";
import { useUserPrefs } from "@/trade/trade-prefs";
import { bootstrapTradesAccountId, resolveAccount } from "@/trade/accounts";
import { listLoadedFor, useListLoaded } from "@/trade/list-loaded-store";
import { TradesBody } from "@/trade/TradesSheet";
import { useAccountTradesLoaded } from "@/trade/useAccountTrades";
import { Chip } from "@/ui/Chip";

const PAYMENT_FILTERS: readonly PaymentsFilter[] = ["all", "deposits", "withdrawals"];

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

  const [segment, setSegment] = useState<HistorySegment>("trades");
  const [filter, setFilter] = useState<PaymentsFilter>("all");
  // Which payment's detail sheet is open (null = closed). Cleared on dismiss, so the same link opens it again.
  const [openKey, setOpenKey] = useState<string | null>(null);

  // A link (`/history?filter=payments|deposits|withdrawals|trades&tx=d:<id>|w:<id>`) picks the segment, the filter and the
  // sheet once, then clears its params so the same link works again (this tab stays mounted between visits). Cleared on
  // this screen's own route, never on whichever route happens to be focused.
  const navigation = useNavigation();
  const params = useLocalSearchParams<{ tx?: string | string[]; filter?: string | string[] }>();
  const asked = historyParams(params);
  const { segment: askedSegment, filter: askedFilter, txKey: askedTx } = asked;
  useEffect(() => {
    if (askedSegment === null && askedTx === null) return;
    if (askedSegment !== null) setSegment(askedSegment);
    if (askedFilter !== null) setFilter(askedFilter);
    if (askedTx !== null) setOpenKey(askedTx);
    navigation.setParams({ tx: undefined, filter: undefined } as never);
  }, [askedSegment, askedFilter, askedTx, navigation]);

  const header = (
    <View style={{ paddingTop: 20, gap: segment === "payments" ? 16 : 24 }}>
      <Txt size={28} weight={600} accessibilityRole="header" style={{ paddingHorizontal: 20 }}>{t("redesign.activity")}</Txt>
      <View accessibilityRole="tablist" style={{ flexDirection: "row", gap: 10, paddingHorizontal: 20 }}>
        <Chip testID="history-seg-trades" role="tab" label={t("tabs.trade")} selected={segment === "trades"} onPress={() => setSegment("trades")} />
        <Chip testID="history-seg-payments" role="tab" label={t("tabs.payments")} selected={segment === "payments"} onPress={() => setSegment("payments")} />
      </View>
      {segment === "payments" ? (
        <View accessibilityRole="tablist" style={{ flexDirection: "row", gap: 8, paddingHorizontal: 20 }}>
          {PAYMENT_FILTERS.map((f) => (
            <Chip key={f} testID={`history-filter-${f}`} role="tab" size={13} height={36} label={t(`history.filter.${f}`)} selected={filter === f} onPress={() => setFilter(f)} />
          ))}
        </View>
      ) : null}
    </View>
  );

  return (
    <Screen>
      {segment === "payments" ? (
        <PaymentsList header={header} filter={filter} onOpen={setOpenKey} />
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: 24, gap: 24 }}>
          {header}
          {boot && account ? <TradesBody accountId={account.id} accountType={account.type} assets={boot.assets} currency={account.currency} listLoaded={loaded} loadingWhenEmpty /> : query.isError ? <Button label={t("common.retry")} onPress={() => void query.refetch()} /> : <Skeleton height={100} />}
        </ScrollView>
      )}
      <DetailSheet paymentKey={openKey} onClose={() => setOpenKey(null)} />
    </Screen>
  );
}
