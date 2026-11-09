import { router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, RefreshControl, ScrollView, View } from "react-native";
import { useTranslation } from "react-i18next";
import { ApiError } from "@/api/errors";
import { shouldRefetchOnFocus } from "@/api/focus-refetch";
import { queryClient, useBootstrap, useCheckout, usePaymentsInfinite, useWallet } from "@/api/queries";
import { refreshBootstrap } from "@/api/refresh-bootstrap";
import { useSession } from "@/auth/session-store";
import { useSessionLive } from "@/auth/use-session-live";
import { hubBalances, pendingIsStale, pendingRowDecision, RECENT_LIMIT, showKycNextStep } from "@/payments/hub-model";
import { PendingPaymentRow } from "@/payments/PendingPaymentRow";
import { clearPendingCheckout, loadPendingCheckout, type PendingCheckout } from "@/payments/pending-checkout";
import { BonusSheet } from "@/payments/BonusSheet";
import { useSocket } from "@/socket/socket-store";
import { Button, Card, Screen, Skeleton, Txt } from "@/theme/ui";
import { color } from "@/theme/tokens";
import { money } from "@/money/format";
import { Icon } from "@/ui/Icon";
import { Money } from "@/ui/Money";
import { PaymentActivity } from "@/ui/PaymentActivity";
import type { SheetRef } from "@/ui/Sheet";

export default function Payments() {
  const { t } = useTranslation();
  const token = useSession(s => s.token);
  const boot = useBootstrap(!!token).data;
  const sessionLive = useSessionLive();
  const wallet = useWallet(sessionLive);
  const payments = usePaymentsInfinite(sessionLive);
  const bonusSheet = useRef<SheetRef>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [pending, setPending] = useState<PendingCheckout | null>(null);
  const live = wallet.data?.accounts.find(a => a.type === "LIVE") ?? boot?.accounts.find(a => a.type === "LIVE");
  // The socket's balance moves with every trade; the wallet is the fallback until it has one.
  const socketBalance = useSocket(s => (live ? s.trades.balances[live.id] : undefined));
  const balances = hubBalances({ live, socket: socketBalance, withdrawable: wallet.data?.withdrawable, lockedBonus: wallet.data?.lockedBonus });
  const { refetch: refetchWallet } = wallet;
  const { refetch: refetchPayments } = payments;
  // Never cancel a request that is already in flight (the first focus lands while the mount fetch is running).
  // `refetch` ignores `enabled`, so the session gate is checked here: nothing fetches while locked or signed out.
  // The socket only moves balances on trades: a deposit credited, a withdrawal paid or a refund while away is
  // only in a fresh bootstrap, which re-seeds `balances` (timestamp rule), so focus and pull refresh it too.
  // The payments list is an infinite query: `refetch()` re-requests every loaded page, so it refetches on focus only once stale.
  const paymentsUpdatedAt = useRef(payments.dataUpdatedAt);
  paymentsUpdatedAt.current = payments.dataUpdatedAt;
  useFocusEffect(useCallback(() => {
    if (!sessionLive) return;
    void refetchWallet({ cancelRefetch: false });
    if (shouldRefetchOnFocus({ live: sessionLive, dataUpdatedAt: paymentsUpdatedAt.current, now: Date.now() })) void refetchPayments({ cancelRefetch: false });
    refreshBootstrap(queryClient);
  }, [sessionLive, refetchWallet, refetchPayments]));
  // The deposit the user started and has not finished: read on every focus (the pay screen may have just ended it), and
  // forgotten once its window has passed. Per user, so a shared phone never offers one person the other's payment.
  const userId = boot?.userId;
  const [focusTick, setFocusTick] = useState(0);
  useFocusEffect(useCallback(() => {
    const saved = userId ? loadPendingCheckout(userId) : null;
    if (userId && pendingIsStale(saved, Date.now())) clearPendingCheckout(userId);
    setPending(saved && !pendingIsStale(saved, Date.now()) ? saved : null);
    setFocusTick(n => n + 1);
  }, [userId]));
  // The row is only for a payment the server says is still open: one read of the saved checkout per focus (no polling,
  // session-gated). Hooks stay unconditional: an empty token and `enabled: false` mean no request.
  const savedCheckout = useCheckout(pending?.token ?? "", sessionLive && !!pending);
  const { refetch: refetchSaved } = savedCheckout;
  const savedToken = pending?.token;
  useEffect(() => {
    // After the render that carries the token, so the refetch is for this checkout; never cancels the mount fetch.
    if (focusTick > 0 && sessionLive && savedToken) void refetchSaved({ cancelRefetch: false });
  }, [focusTick, sessionLive, savedToken, refetchSaved]);
  const decision = pendingRowDecision({
    pending,
    nowMs: Date.now(),
    view: savedCheckout.data ?? null,
    errorStatus: savedCheckout.error instanceof ApiError ? savedCheckout.error.status : null,
  });
  const forget = decision.clear;
  useEffect(() => {
    if (!forget) return;
    if (userId) clearPendingCheckout(userId);
    setPending(null);
  }, [forget, userId]);
  const refresh = async () => {
    if (!sessionLive) return;
    setRefreshing(true);
    refreshBootstrap(queryClient);
    try { await Promise.all([refetchWallet(), refetchPayments()]); } finally { setRefreshing(false); }
  };
  return <Screen><ScrollView contentContainerStyle={{ padding: 20, gap: 28 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={color.accentText} colors={[color.accent]} />}>
    <Txt size={28} weight={600} accessibilityRole="header">{t("redesign.yourMoney")}</Txt>
    <View style={{ gap: 12 }}>
      <Txt size={13} color={color.up}>{t("trade.liveAccount")}</Txt>
      {balances ? <View style={{ width: "100%" }}><Money text={money(balances.totalMinor, balances.currency)} size={40} weight={500} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6} /></View> : wallet.isError ? <Button label={t("common.retry")} kind="secondary" onPress={() => void wallet.refetch()} /> : <Skeleton height={52} />}
      {balances ? <View style={{ flexDirection: "row", gap: 12 }}>
        <View style={{ flex: 1, minHeight: 44, justifyContent: "center" }}>{balances.withdrawableMinor === null ? <Skeleton height={14} width="70%" /> : <Txt size={12} color={color.ink2} numberOfLines={1}>{t("redesign.withdrawable")} {money(balances.withdrawableMinor, balances.currency)}</Txt>}</View>
        <Pressable testID="payments-bonus" accessibilityRole="button" accessibilityLabel={`${t("redesign.bonus")} ${money(balances.bonusMinor, balances.currency)}`} accessibilityHint={t("payments.bonusHint")} onPress={() => bonusSheet.current?.present()} style={{ flex: 1, minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 4 }}>
          <Txt size={12} color={color.gold} numberOfLines={1} style={{ flexShrink: 1, textAlign: "right" }}>{t("redesign.bonus")} {money(balances.bonusMinor, balances.currency)}</Txt>
          <Icon name="chevron" size={14} color={color.gold} />
        </Pressable>
      </View> : null}
    </View>
    <View style={{ flexDirection: "row", gap: 12 }}><View style={{ flex: 1 }}><Button testID="payments-withdraw" label={t("withdraw.title")} kind="secondary" onPress={() => router.push("/payments/withdraw")} /></View><View style={{ flex: 1 }}><Button testID="payments-deposit" label={t("redesign.addMoney")} kind="light" onPress={() => router.push("/payments/deposit")} /></View></View>
    {decision.row ? <PendingPaymentRow pending={decision.row} /> : null}
    {showKycNextStep(boot?.profile.kycStatus) ? <Card><Txt size={12} color={color.accentText}>{t("redesign.nextStep")}</Txt><Txt size={20} weight={600} style={{ marginTop: 8 }}>{t("redesign.verify")}</Txt><Txt size={14} color={color.ink2} style={{ marginVertical: 8 }}>{t("redesign.verificationHint")}</Txt><Button label={t("payments.verifyAction")} kind="text" onPress={() => router.push("/account/verify")} /></Card> : null}
    <View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <Txt size={20} weight={600} style={{ flex: 1 }}>{t("redesign.recentActivity")}</Txt>
        <Pressable testID="payments-see-all" accessibilityRole="link" onPress={() => router.push({ pathname: "/history", params: { filter: "payments" } })} style={{ minHeight: 44, justifyContent: "center", flexShrink: 0 }}><Txt size={14} weight={600} color={color.accentText}>{t("common.seeAll")}</Txt></Pressable>
      </View>
      <PaymentActivity limit={RECENT_LIMIT} />
    </View>
  </ScrollView>
  <BonusSheet ref={bonusSheet} completedDeposits={wallet.data?.completedDeposits ?? boot?.completedDeposits ?? 0} /></Screen>;
}
