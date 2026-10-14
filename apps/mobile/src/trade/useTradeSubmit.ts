import * as Haptics from "expo-haptics";
import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/api/client";
import { queryClient } from "@/api/queries";
import { errorText } from "@/auth/messages";
import { useSocket } from "@/socket/socket-store";
import { toast } from "@/ui/Toast";
import { OpenTradeResultSchema, buildOpenTradeBody } from "./trade-request";

interface SubmitInput {
  accountId: string;
  symbol: string;
  /** Minor units; null while the typed stake is not valid. */
  stakeMinor: number | null;
  durationSec: number;
}

/**
 * Opens a trade over HTTP (the response is authoritative: it carries the trade and the new balances).
 * A second tap while one is in flight is ignored, via a ref so two taps in one frame cannot both pass.
 */
export function useTradeSubmit(input: SubmitInput): { submit: (direction: "UP" | "DOWN") => Promise<void>; busy: boolean } {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const { accountId, symbol, stakeMinor, durationSec } = input;

  const submit = useCallback(
    async (direction: "UP" | "DOWN") => {
      if (inFlight.current || stakeMinor === null) return;
      inFlight.current = true;
      setBusy(true);
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      try {
        const body = buildOpenTradeBody({ accountId, symbol, direction, stakeMinor, durationSec });
        const raw = await api("/api/trades", { method: "POST", body });
        const parsed = OpenTradeResultSchema.safeParse(raw);
        if (parsed.success) {
          useSocket.getState().applyOpenResult(parsed.data);
        } else {
          // The server accepted the trade but answered in a shape we cannot read: reconcile from bootstrap.
          void queryClient.invalidateQueries({ queryKey: ["bootstrap"] });
          toast(t("common.genericError"), "down");
        }
      } catch (e) {
        toast(errorText(e, t, "trade.failed"), "down");
      } finally {
        inFlight.current = false;
        setBusy(false);
      }
    },
    [accountId, symbol, stakeMinor, durationSec, t],
  );

  return { submit, busy };
}
