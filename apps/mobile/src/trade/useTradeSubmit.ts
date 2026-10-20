import * as Haptics from "expo-haptics";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/api/client";
import { queryClient } from "@/api/queries";
import { useSession } from "@/auth/session-store";
import { refreshBootstrap } from "@/api/refresh-bootstrap";
import { useSocket } from "@/socket/socket-store";
import { toast } from "@/ui/Toast";
import { fetchAccountTrades } from "./fetch-account-trades";
import { createSubmitter } from "./submit-flow";

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

/** Opens a trade over HTTP (the response is authoritative: trade plus new balances). Flow lives in `submit-flow`. */
export function useTradeSubmit(input: SubmitInput): { submit: (direction: "UP" | "DOWN") => Promise<void>; busy: boolean } {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const { accountId, symbol, stakeMinor, durationSec, currency } = input;

  const run = useMemo(
    () =>
      createSubmitter({
        openTrade: (body) => api("/api/trades", { method: "POST", body, timeoutMs: OPEN_TRADE_TIMEOUT_MS }),
        applyOpenResult: (r) => useSocket.getState().applyOpenResult(r),
        toast,
        haptic: () => void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium),
        invalidateBootstrap: () => refreshBootstrap(queryClient),
        refetchTrades: (id) => void fetchAccountTrades(id).catch(() => {}),
        session: () => useSession.getState().token,
        setBusy,
        t,
      }),
    [t],
  );

  const submit = useCallback(
    async (direction: "UP" | "DOWN") => {
      if (stakeMinor === null) return;
      await run({ accountId, symbol, direction, stakeMinor, durationSec, currency });
    },
    [run, accountId, symbol, stakeMinor, durationSec, currency],
  );

  return { submit, busy };
}
