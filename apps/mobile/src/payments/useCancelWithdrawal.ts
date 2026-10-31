import { useEffect, useRef, useState } from "react";
import { Alert } from "react-native";
import { useTranslation } from "react-i18next";
import { api } from "@/api/client";
import { invalidateMoney, queryClient } from "@/api/queries";
import { useSession } from "@/auth/session-store";
import { money } from "@/money/format";
import { toast } from "@/ui/Toast";
import { nextCancelDeadlineMs, type CancelWindow } from "./withdraw-form";
import { WITHDRAW_TIMEOUT_MS, createCancelSubmitter } from "./withdraw-submit";

/** The saved payouts, the KYC state and the held withdrawals all come from one prefill read; any money move makes it stale. */
export const refetchPrefill = () => void queryClient.invalidateQueries({ queryKey: ["withdrawal-prefill"] });

/** Longest a timer is set for: setTimeout overflows (and fires at once) past 2^31 ms. */
const MAX_TIMER_MS = 2_000_000_000;

/**
 * Cancelling a held withdrawal, shared by the Withdraw screen and the History detail sheet: the confirm Alert, then the
 * money-moving POST (15 s timeout, one at a time, never retried; see `createCancelSubmitter`). `rows` are the held
 * withdrawals on screen: the caller re-renders when the next cancel window closes (so Cancel disappears while the screen
 * is open) and again after a cancel attempt ends (a refusal may mean the window just closed).
 */
export function useCancelWithdrawal(currency: string, rows: readonly CancelWindow[]) {
  const { t } = useTranslation();
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  // Bumped to re-render when a cancel window closes; the check itself reads the clock at render, so it is never stale.
  const [, setTick] = useState(0);

  useEffect(() => {
    const next = nextCancelDeadlineMs(rows, Date.now());
    if (next === null) return;
    const timer = setTimeout(() => setTick((n) => n + 1), Math.min(next - Date.now() + 250, MAX_TIMER_MS));
    return () => clearTimeout(timer);
  });
  const wasCancelling = useRef(false);
  useEffect(() => {
    if (cancellingId !== null) wasCancelling.current = true;
    else if (wasCancelling.current) {
      wasCancelling.current = false;
      setTick((n) => n + 1);
    }
  }, [cancellingId]);

  // The submitter is built once (its in-flight flag must survive re-renders); it reads the latest `t` from here.
  const latest = useRef({ t });
  latest.current = { t };
  const canceller = useRef<ReturnType<typeof createCancelSubmitter> | null>(null);
  if (canceller.current === null) {
    canceller.current = createCancelSubmitter({
      post: (id) => api(`/api/withdrawals/${encodeURIComponent(id)}/cancel`, { method: "POST", timeoutMs: WITHDRAW_TIMEOUT_MS }),
      invalidateMoney,
      invalidatePrefill: refetchPrefill,
      toast,
      session: () => useSession.getState().token,
      setBusyId: setCancellingId,
      t: (key, options) => latest.current.t(key, options),
    });
  }

  const confirmCancel = (id: string, amountMinor: number) => {
    const amountText = money(amountMinor, currency, { trim: true });
    Alert.alert(t("withdraw.cancelConfirmTitle"), t("withdraw.cancelConfirmBody", { amount: amountText }), [
      { text: t("withdraw.cancelKeep"), style: "cancel" },
      { text: t("withdraw.cancelYes"), style: "destructive", onPress: () => void canceller.current?.(id) },
    ]);
  };

  return { cancellingId, confirmCancel };
}
