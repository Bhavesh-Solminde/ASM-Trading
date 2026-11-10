import { useFocusEffect } from "expo-router";
import { useCallback } from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { queryClient, useBootstrap, useWallet, useWithdrawalPrefill } from "@/api/queries";
import { refreshBootstrap } from "@/api/refresh-bootstrap";
import { useSession } from "@/auth/session-store";
import { useSessionLive } from "@/auth/use-session-live";
import { hubBalances } from "@/payments/hub-model";
import { WithdrawContent } from "@/payments/WithdrawForm";
import { useSocket } from "@/socket/socket-store";
import { color } from "@/theme/tokens";
import { Button, Screen, Skeleton, Txt } from "@/theme/ui";
import { BackHeader } from "@/ui/BackHeader";
import { FormScroll } from "@/ui/form";

/**
 * Withdraw, from the LIVE account. This shell loads what the form stands on (the LIVE account, its withdrawable
 * balance from the wallet, and the prefill: KYC state, last payouts, held withdrawals) and hands it to
 * `WithdrawContent`. Every query waits for a live session, and all of them refetch whenever the screen comes into focus.
 */
export default function Withdraw() {
  const { t } = useTranslation();
  const token = useSession((s) => s.token);
  const boot = useBootstrap(!!token).data;
  const sessionLive = useSessionLive();
  const wallet = useWallet(sessionLive);
  const prefill = useWithdrawalPrefill(sessionLive);
  const live = wallet.data?.accounts.find((a) => a.type === "LIVE") ?? boot?.accounts.find((a) => a.type === "LIVE");
  // The socket's balance moves with every trade; the wallet is the fallback until it has one (as on Payments).
  const socketBalance = useSocket((s) => (live ? s.trades.balances[live.id] : undefined));
  const balances = hubBalances({ live, socket: socketBalance, withdrawable: wallet.data?.withdrawable, lockedBonus: wallet.data?.lockedBonus });
  const { refetch: refetchWallet } = wallet;
  const { refetch: refetchPrefill } = prefill;
  // `refetch` ignores `enabled`, so the session gate is checked here: nothing fetches while locked or signed out.
  useFocusEffect(
    useCallback(() => {
      if (!sessionLive) return;
      void refetchWallet({ cancelRefetch: false });
      void refetchPrefill({ cancelRefetch: false });
      refreshBootstrap(queryClient);
    }, [sessionLive, refetchWallet, refetchPrefill]),
  );

  const withdrawable = balances?.withdrawableMinor ?? null;
  const failed = (!wallet.data && wallet.isError) || (!prefill.data && prefill.isError);
  return (
    <Screen>
      <FormScroll top>
        <View style={{ padding: 20, gap: 20 }}>
          <BackHeader title={t("withdraw.title")} />
          {live && prefill.data && withdrawable !== null ? (
            <WithdrawContent live={live} prefill={prefill.data} withdrawable={withdrawable} />
          ) : failed ? (
            <View style={{ gap: 12 }}>
              <Txt color={color.ink2}>{t("common.genericError")}</Txt>
              <Button
                label={t("common.retry")}
                kind="secondary"
                onPress={() => {
                  void refetchWallet();
                  void refetchPrefill();
                }}
              />
            </View>
          ) : (
            <View accessibilityRole="progressbar" accessibilityLabel={t("common.loading")} style={{ gap: 12 }}>
              <Skeleton height={96} />
              <Skeleton height={44} />
              <Skeleton height={160} />
            </View>
          )}
        </View>
      </FormScroll>
    </Screen>
  );
}
