import { askPermissionAt } from "@/push/push";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { z } from "zod";
import { useTranslation } from "react-i18next";
import { CfdTradeViewSchema, type Bootstrap } from "@asm/contracts";
import { api } from "@/api/client";
import { ApiError } from "@/api/errors";
import { queryClient } from "@/api/queries";
import { refreshBootstrap } from "@/api/refresh-bootstrap";
import { useSessionLive } from "@/auth/use-session-live";
import { useSession } from "@/auth/session-store";
import { useSocket } from "@/socket/socket-store";
import { toast } from "@/ui/Toast";
import { money } from "@/money/format";

const Lists = z.object({ currency: z.string(), trades: z.array(z.unknown()) });
export const OpenResult = z.object({ trade: CfdTradeViewSchema, balances: z.object({ realBalance: z.number().int(), bonusBalance: z.number().int() }) });
const pending = new Map<string, Promise<boolean>>();
function currentCurrency(accountId: string) {
  return queryClient.getQueryData<Bootstrap>(["bootstrap"])?.accounts.find(a => a.id === accountId)?.currency;
}
export function refreshCfd(accountId: string, expectedCurrency = currentCurrency(accountId)): Promise<boolean> {
  const token = useSession.getState().token;
  if (!token || !accountId) return Promise.resolve(false);
  const generation = expectedCurrency ? useSocket.getState().prepareCfdAccount(accountId, expectedCurrency) : useSocket.getState().cfdGeneration[accountId] ?? 0;
  const revision = useSocket.getState().cfdRevision[accountId] ?? 0;
  const key = token + accountId + expectedCurrency + generation + ":" + revision;
  const old = pending.get(key);
  if (old) return old;
  const promise = api("/api/cfd/trades?accountId=" + encodeURIComponent(accountId), { schema: Lists, timeoutMs: 15000, silentRateLimit: true }).then(res => {
    if (revision === (useSocket.getState().cfdRevision[accountId] ?? 0) && generation === (useSocket.getState().cfdGeneration[accountId] ?? 0) && token === useSession.getState().token && (!expectedCurrency || res.currency === expectedCurrency) && (!currentCurrency(accountId) || currentCurrency(accountId) === res.currency)) {
      const before = useSocket.getState().lastCfdSettled;
      useSocket.getState().mergeCfdTrades(accountId, res.trades);
      if (before !== useSocket.getState().lastCfdSettled) refreshBootstrap(queryClient);
      return true;
    }
    return false;
  }).finally(() => pending.delete(key));
  pending.set(key, promise);
  return promise;
}
/** Reconnect, foreground and bounded polling recover results even if the socket missed a close. */
export function useCfdAccount(accountId: string | undefined, currency: string | undefined, enabled: boolean) {
  const live = useSessionLive();
  const [loaded, setLoaded] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const phase = useSocket(s => s.phase);
  const bookCurrency = useSocket(s => accountId ? s.cfdCurrency[accountId] : undefined);
  useEffect(() => {
    if (!enabled || !accountId || !live) return;
    let stale = false;
    const run = () => {
      if (AppState.currentState !== "active") return;
      void refreshCfd(accountId, currency).then(applied => { if (!stale && applied) { setLoaded(accountId + currency); setFailed(false); } }, () => { if (!stale) setFailed(true); });
    };
    run();
    const timer = setInterval(run, 10000);
    const sub = AppState.addEventListener("change", state => { if (state === "active") run(); });
    return () => { stale = true; clearInterval(timer); sub.remove(); };
  }, [accountId, currency, enabled, phase, live]);
  return { loaded: !!accountId && bookCurrency === currency && loaded === accountId + currency, failed, retry: () => accountId && refreshCfd(accountId) };
}
export function cfdErrorKey(error: unknown): string {
  if (!(error instanceof ApiError)) return "cfd.failed";
  if (error.code === "account_not_active") return "cfd.errors.trading_paused";
  if (error.code === "currency_changed") return "trade.currencyChanged";
  if (error.code === "timeout" || error.code === "offline") return "cfd.unclear";
  const known = ["market_closed", "market_unavailable", "insufficient_balance", "lockout_active", "invalid_stops", "stake_exceeds_limit", "trading_paused", "trade_not_open"];
  return known.includes(error.code ?? "") ? `cfd.errors.${error.code}` : "cfd.failed";
}
/** Single-flight across renders; uncertain mutations reconcile and never auto-retry. */
export function useCfdMutation(accountId: string, currency: string) {
  const { t } = useTranslation();
  const flight = useRef(false);
  const [busy, setBusy] = useState(false);
  const run = useCallback(async (path: string, body?: unknown, method = "POST") => {
    if (flight.current) return false;
    const token = useSession.getState().token;
    if (!token) return false;
    flight.current = true; setBusy(true);
    useSocket.getState().touchCfdAccount(accountId);
    let ok = false;
    try {
      const result = await api(path, { method, body, timeoutMs: 15000 });
      if (useSession.getState().token !== token || currentCurrency(accountId) && currentCurrency(accountId) !== currency) return false;
      const parsed = OpenResult.safeParse(result);
      if (parsed.success) useSocket.getState().applyCfdResult(parsed.data);
      ok = true;
    } catch (error) {
      if (useSession.getState().token === token) toast(t(cfdErrorKey(error)), "down");
    } finally {
      if (useSession.getState().token === token) {
        useSocket.getState().touchCfdAccount(accountId);
        // Keep the button busy until the account's authoritative list has reconciled.
        await refreshCfd(accountId).catch(() => {});
        refreshBootstrap(queryClient);
      }
      flight.current = false; setBusy(false);
    }
    return ok;
  }, [accountId, currency, t]);
  return { run, busy };
}

// Survives screen remounts; trade IDs are globally unique and sessions reset the book.
const announced = new Set<string>();
export function useCfdFeedback(accountId: string | undefined, currency: string | undefined) {
  const { t } = useTranslation();
  const live = useSessionLive();
  const latest = useRef({ accountId, currency, t, live });
  useEffect(() => { latest.current = { accountId, currency, t, live }; }, [accountId, currency, t, live]);
  useEffect(() => useSocket.subscribe((state, previous) => {
    const { accountId: id, currency: cur, t: tr, live: active } = latest.current;
    if (!id || !cur || !active) return;
    const was = new Map((previous.cfd[id] ?? []).map(p => [p.id, p]));
    for (const closed of state.cfd[id] ?? []) {
      if (closed.status !== "CLOSED" || was.get(closed.id)?.status !== "OPEN" || announced.has(closed.id)) continue;
      announced.add(closed.id);
      if (queryClient.getQueryData<Bootstrap>(["bootstrap"])?.accounts.find(a => a.id === id)?.type === "LIVE") {
        void askPermissionAt("live_trade_settled");
      }
      const net = closed.pnl - (closed.spreadFee ?? 0);
      toast(tr("cfd.result", { amount: `${net > 0 ? "+" : ""}${money(net, cur)}` }), net < 0 ? "down" : "up");
      refreshBootstrap(queryClient);
    }
  }), []);
}
