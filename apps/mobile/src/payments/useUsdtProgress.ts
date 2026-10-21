import { useEffect, useRef, useState } from "react";
import type { CheckoutView } from "@asm/contracts";
import { useUsdtChainStatus } from "@/api/queries";
import { useSessionLive } from "@/auth/use-session-live";
import { visibleRefetchDue } from "./checkout-poll";
import { usePayVisible } from "./usePayVisible";
import { usdtDeadlineStep, usdtLapsed, usdtProgress, usdtProgressWanted, type UsdtProgress } from "./usdt-progress";

/** What the pay screen needs of a USDT payment: where the transfer is on-chain, and whether its window is over with nothing on its way. */
export interface UsdtPayState {
  progress: UsdtProgress;
  /** True once the deadline passed and the last status check found no live transfer: the screen must stop showing the address. */
  lapsed: boolean;
}

/**
 * A USDT payment's on-chain progress for the pay screen: detected, confirming, failed, under review. Called ONCE, by
 * the pay screen (never also by a child, so the status route is polled from one place only). It asks only while the
 * checkout is an open USDT one and, like the checkout poll, polls only while the screen is visible (focused, the app
 * in front, the session live). Coming back into view refetches once instead of waiting out the interval. Anything it
 * cannot read counts as "nothing detected", the screen's ordinary waiting state.
 *
 * It also watches the deadline (`expiresAt`), as the website's poller does. The server keeps an unpaid manual or slot
 * deposit open for up to 48 h past it and a slot address goes to another user 2 minutes after it, so an address that is
 * still on screen could take a late transfer for someone else. One timer is armed for the deadline (re-armed when
 * `expiresAt` changes, cleared when the screen is hidden, backgrounded or unmounted); when it fires, and on coming back
 * into view after the deadline, the status is fetched once more and, if no live transfer shows, `lapsed` turns true.
 * Both polls keep running, so a late credit still reaches the receipt and a late detection takes `lapsed` away again.
 */
export function useUsdtProgress(token: string, view: CheckoutView | undefined): UsdtPayState {
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

  const progress = usdtProgress(query.data);

  // The deadline watcher. Only an open (AWAITING_PAYMENT) USDT checkout has an address to take back.
  const expiresAt = view?.expiresAt ?? "";
  const open = wanted && view?.status === "AWAITING_PAYMENT";
  const watching = open && sessionLive && visible && token !== "";
  // When the last check after the deadline found nothing live; `lapsed` is derived from it so a later detection clears it.
  const [checkedAtMs, setCheckedAtMs] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const lastCheck = async () => {
      const result = await refetch();
      if (cancelled) return;
      const nowMs = Date.now();
      // A failed fetch keeps the last answer (the website falls through to leaving the page).
      if (usdtLapsed({ expiresAt, nowMs, progress: usdtProgress(result.data) })) setCheckedAtMs(nowMs);
    };
    const run = () => {
      const step = usdtDeadlineStep({ expiresAt, nowMs: Date.now(), enabled: watching });
      if (step.kind === "arm") timer = setTimeout(run, step.delayMs);
      else if (step.kind === "check") void lastCheck();
    };
    run();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [watching, expiresAt]);

  const lapsed = open && checkedAtMs !== null && usdtLapsed({ expiresAt, nowMs: checkedAtMs, progress });
  return { progress, lapsed };
}
