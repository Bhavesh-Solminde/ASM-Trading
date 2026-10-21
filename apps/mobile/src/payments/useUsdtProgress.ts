import { useEffect, useRef } from "react";
import type { CheckoutView } from "@asm/contracts";
import { useUsdtChainStatus } from "@/api/queries";
import { useSessionLive } from "@/auth/use-session-live";
import { visibleRefetchDue } from "./checkout-poll";
import { usePayVisible } from "./usePayVisible";
import { usdtProgress, usdtProgressWanted, type UsdtProgress } from "./usdt-progress";

/**
 * A USDT payment's on-chain progress for the pay screen: detected, confirming, failed, under review. Called ONCE, by
 * the pay screen (never also by a child, so the status route is polled from one place only). It asks only while the
 * checkout is an open USDT one and, like the checkout poll, polls only while the screen is visible (focused, the app
 * in front, the session live). Coming back into view refetches once instead of waiting out the interval. Anything it
 * cannot read counts as "nothing detected", the screen's ordinary waiting state.
 */
export function useUsdtProgress(token: string, view: CheckoutView | undefined): UsdtProgress {
  const sessionLive = useSessionLive();
  const visible = usePayVisible();
  const wanted = usdtProgressWanted({ method: view?.method, checkoutStatus: view?.status });
  const query = useUsdtChainStatus(token, sessionLive && token !== "" && wanted, { poll: visible });
  const { refetch, isFetching, dataUpdatedAt } = query;

  const wasVisible = useRef(false);
  useEffect(() => {
    const due = wanted && visibleRefetchDue({ wasVisible: wasVisible.current, visible, isFetching, lastFetchAtMs: dataUpdatedAt, nowMs: Date.now() });
    wasVisible.current = visible;
    if (due && sessionLive) void refetch({ cancelRefetch: false });
    // Only a change of `visible` decides this.
  }, [visible]);

  return usdtProgress(query.data);
}
