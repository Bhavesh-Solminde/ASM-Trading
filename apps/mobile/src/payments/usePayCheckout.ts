import { useFocusEffect } from "expo-router";
import * as Haptics from "expo-haptics";
import { useCallback, useEffect, useRef, useState } from "react";
import { invalidateMoney, useBootstrap, useCheckout } from "@/api/queries";
import { useSession } from "@/auth/session-store";
import { useSessionLive } from "@/auth/use-session-live";
import { useAppStatus } from "@/lock/app-state";
import { finalEffects, isFinalStatus, visibleRefetchDue } from "./checkout-poll";
import { pendingFromView } from "./pay-model";
import { clearPendingCheckout, loadPendingCheckout, savePendingCheckout } from "./pending-checkout";

/**
 * The pay screen's data: the checkout, refetched every 4s while the screen is visible and the payment is open.
 *
 * "Visible" = this screen is focused (not covered by the claim screen or another tab), the app is in front, and the
 * session is live (a relock makes it false until unlock). Any of them ending stops the clock; all of them back
 * together refetches once (not on top of a fetch already running) instead of waiting out the interval.
 *
 * Side effects, once each: when the payment first shows as saved with its real expiry and amount (Payments then offers
 * "Continue"), and when it reaches a final status (refresh the money queries, forget the pending checkout, buzz on a
 * success the user watched land).
 */
export function usePayCheckout(token: string) {
  const sessionLive = useSessionLive();
  const appActive = useAppStatus((s) => s.appState === "active");
  const signedIn = useSession((s) => !!s.token);
  const userId = useBootstrap(signedIn).data?.userId;
  const [focused, setFocused] = useState(false);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );
  const visible = focused && appActive && sessionLive;
  const query = useCheckout(token, sessionLive, { poll: visible });
  const { refetch, isFetching, dataUpdatedAt } = query;

  const wasVisible = useRef(false);
  useEffect(() => {
    const due = visibleRefetchDue({ wasVisible: wasVisible.current, visible, isFetching, lastFetchAtMs: dataUpdatedAt, nowMs: Date.now() });
    wasVisible.current = visible;
    // `cancelRefetch: false`: never abort a request that is already on its way to start another.
    if (due) void refetch({ cancelRefetch: false });
    // Only a change of `visible` decides this; the other two are read as they are at that moment.
  }, [visible]);

  const view = query.data;
  const status = view?.status ?? null;
  const previous = useRef<string | null>(null);
  const closedOut = useRef(false);
  useEffect(() => {
    if (!userId || !view) return;
    const fx = finalEffects({ prev: previous.current, next: status, handled: closedOut.current });
    previous.current = status;
    if (fx.run) {
      closedOut.current = true;
      invalidateMoney();
      clearPendingCheckout(userId);
      if (fx.haptic) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      return;
    }
    if (isFinalStatus(status)) return;
    const pending = pendingFromView({ existing: loadPendingCheckout(userId), token, view });
    if (pending) savePendingCheckout(userId, pending);
  }, [userId, status, view?.expiresAt, view?.amountInr, token]);

  return query;
}
