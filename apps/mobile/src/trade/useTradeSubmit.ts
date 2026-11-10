import { randomUUID } from "expo-crypto";
import { displayedQuoteFor } from "./displayed-quote";
import { clearAcceptedProtection, protectionFor } from "./protection-store";
import { protectionValid } from "./otc-protection";
import * as Haptics from "expo-haptics";
import { useCallback, useLayoutEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/api/client";
import { queryClient } from "@/api/queries";
import { useSession } from "@/auth/session-store";
import { refreshBootstrap } from "@/api/refresh-bootstrap";
import { useSocket } from "@/socket/socket-store";
import { toast } from "@/ui/Toast";
import { fetchAccountTrades } from "./fetch-account-trades";
import { createSubmitter, type PendingTrade } from "./submit-flow";

interface SubmitInput {
  accountId: string;
  symbol: string;
  /** Minor units; null while the typed stake is not valid. */
  stakeMinor: number | null;
  durationSec: number;
  currency: string;
}

/** A trade POST that gets no answer by then is given up on (the Dock re-enables); see `api` timeoutMs. */
export const OPEN_TRADE_TIMEOUT_MS = 15_000;
// Survives ticket remounts and language changes so an uncertain accepted trade keeps its request key.
let nativeSubmitter: ReturnType<typeof createSubmitter> | null = null;

/** Opens a trade over HTTP (the response is authoritative: trade plus new balances). Flow lives in `submit-flow`. */
export function useTradeSubmit(input: SubmitInput): { submit: (direction: "UP" | "DOWN") => Promise<void>; busy: boolean; pending: PendingTrade | null; retry: () => Promise<void> } {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<PendingTrade | null>(nativeSubmitter?.pendingTrade() ?? null);
  const { accountId, symbol, stakeMinor, durationSec, currency } = input;

  const deps = {
    onPending: setPending,
    openTrade: (body: import("@asm/contracts").OtcOpenTradeInput) => api("/api/trades", { method: "POST", body, timeoutMs: OPEN_TRADE_TIMEOUT_MS }),
    applyOpenResult: (r: import("@asm/contracts").OpenTradeResult) => { useSocket.getState().applyOpenResult(r); clearAcceptedProtection(r.trade); },
    toast,
    haptic: () => void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium),
    invalidateBootstrap: () => refreshBootstrap(queryClient),
    refetchTrades: (id: string) => fetchAccountTrades(id).then(() => {}, () => {}),
    session: () => useSession.getState().token,
    setBusy,
    t,
  };
  const run = nativeSubmitter ??= createSubmitter(deps);
  useLayoutEffect(() => { run.updateDeps(deps); setPending(run.pendingTrade()); });

  const submit = useCallback(
    async (direction: "UP" | "DOWN") => {
      if (run.hasPending()) { toast(t("trade.retryPrevious"), "down"); return; }
      if (stakeMinor === null) return;
      const state = useSocket.getState();
      const quote = displayedQuoteFor(symbol, state.chart.timeframe, state.chart.generation);
      if (state.phase !== "authed" || !quote || quote.expiresAt <= Date.now()) { toast(t("trade.waitPrice"), "down"); return; }
      const protection = protectionFor(`${accountId}:${symbol}`);
      if (!protectionValid(protection, direction, quote.price)) { toast(t("trade.adjustProtection"), "down"); return; }
      await run({ accountId, symbol, direction, stakeMinor, durationSec, currency, displayedPrice: quote.price, quoteToken: quote.token, idempotencyKey: randomUUID(), ...(protection.enabled ? { stopLoss: protection.stopLoss, takeProfit: protection.takeProfit } : {}) });
    },
    [run, accountId, symbol, stakeMinor, durationSec, currency, t],
  );

  return { submit, busy, pending, retry: () => run.retryPending() };
}
