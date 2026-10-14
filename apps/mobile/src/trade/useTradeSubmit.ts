import * as Haptics from "expo-haptics";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/api/client";
import { queryClient } from "@/api/queries";
import { refreshBootstrap } from "@/api/refresh-bootstrap";
import { useSocket } from "@/socket/socket-store";
import { toast } from "@/ui/Toast";
import { createSubmitter } from "./submit-flow";

interface SubmitInput {
  accountId: string;
  symbol: string;
  /** Minor units; null while the typed stake is not valid. */
  stakeMinor: number | null;
  durationSec: number;
}

/** Opens a trade over HTTP (the response is authoritative: trade plus new balances). Flow lives in `submit-flow`. */
export function useTradeSubmit(input: SubmitInput): { submit: (direction: "UP" | "DOWN") => Promise<void>; busy: boolean } {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const { accountId, symbol, stakeMinor, durationSec } = input;

  const run = useMemo(
    () =>
      createSubmitter({
        openTrade: (body) => api("/api/trades", { method: "POST", body }),
        applyOpenResult: (r) => useSocket.getState().applyOpenResult(r),
        toast,
        haptic: () => void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium),
        invalidateBootstrap: () => refreshBootstrap(queryClient),
        setBusy,
        t,
      }),
    [t],
  );

  const submit = useCallback(
    async (direction: "UP" | "DOWN") => {
      if (stakeMinor === null) return;
      await run({ accountId, symbol, direction, stakeMinor, durationSec });
    },
    [run, accountId, symbol, stakeMinor, durationSec],
  );

  return { submit, busy };
}
