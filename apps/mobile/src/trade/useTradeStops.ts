import { useEffect, useRef, useState } from "react";
import { randomUUID } from "expo-crypto";
import { useTranslation } from "react-i18next";
import type { TradeView } from "@asm/contracts";
import { api } from "@/api/client";
import { ApiError } from "@/api/errors";
import { useSession } from "@/auth/session-store";
import { useSocket } from "@/socket/socket-store";
import { toast } from "@/ui/Toast";
import {
  EMPTY_STOPS, canEditStops, clampStops, hasStops, initialStops, sameStops, stopLevels,
  type StopLevels, type StopSide,
} from "./otc-protection";
import { closeStopsDraft, openStopsEditor, postTradeStops, stopsErrorText, type StopsEditor } from "./stops-flow";

const STOPS_TIMEOUT_MS = 10_000;

type Retry = {
  tradeId: string;
  token: string | null;
  levels: StopLevels;
  requestId: string;
};

export function useTradeStops(trade: TradeView | undefined, price: number | null, precision: number) {
  const { t } = useTranslation();
  const [editor, setEditor] = useState<StopsEditor | null>(null);
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const retry = useRef<Retry | null>(null);
  const latest = useRef({ trade, price });
  latest.current = { trade, price };
  const tradeId = trade?.id;
  const priceReady = price !== null && Number.isFinite(price) && price > 0;
  const hasSaved = trade ? hasStops(stopLevels(trade)) : false;

  useEffect(() => {
    const current = latest.current;
    if (!current.trade) {
      setEditor(null);
    } else if (hasSaved || priceReady) {
      const position = current.trade;
      const quote = current.price ?? position.entryPrice;
      setEditor((previous) => previous?.tradeId === position.id ? previous : openStopsEditor(position, quote, precision));
    }
  }, [tradeId, hasSaved, priceReady, precision]);

  if (!trade || editor?.tradeId !== trade.id) return null;
  const positionId = trade.id;
  const applied = stopLevels(trade);
  const draft = editor.draft;
  const preview = draft && priceReady && price !== null ? clampStops(draft, trade, price, precision) : draft;
  // A moved quote can leave no valid tick for a draft. Keep the handles visible while save revalidates them.
  const levels = preview && !hasStops(preview) ? draft ?? applied : preview ?? applied;
  const hasApplied = hasStops(applied);
  const mode = draft ? (hasApplied ? "update" : "set") : (hasApplied ? "remove" : "add");

  function changeDraft(change: (before: StopLevels) => StopLevels) {
    if (sending.current) return;
    setEditor((current) => current?.tradeId === positionId
      ? { ...current, error: null, draft: change(current.draft ?? applied) }
      : current);
  }

  async function save(next: StopLevels, editingDraft: boolean) {
    if (sending.current || !trade) return;
    const socket = useSocket.getState();
    const current = socket.trades.tradesByAccount[trade.accountId]?.find(({ id }) => id === trade.id);
    if (!current || !canEditStops(current, Date.now())) {
      // The editor may disappear on the next market frame when the trade expires.
      toast(t("trade.stops.ended"), "down");
      return;
    }
    const quote = socket.chart.symbol === current.symbol ? socket.chart.lastPrice : null;
    if (editingDraft && (socket.phase !== "authed" || quote === null || !Number.isFinite(quote) || quote <= 0)) {
      setEditor((state) => state?.tradeId === current.id ? { ...state, error: t("trade.waitPrice") } : state);
      return;
    }
    const requested = editingDraft && quote !== null ? clampStops(next, current, quote, precision) : next;
    const before = stopLevels(current);
    if (editingDraft && !hasStops(requested) && (hasStops(next) || !hasStops(before))) {
      setEditor((state) => state?.tradeId === current.id ? { ...state, error: t("trade.stops.moveAway") } : state);
      return;
    }
    if (sameStops(requested, before)) {
      setEditor((state) => state?.tradeId === current.id ? closeStopsDraft(state) : state);
      return;
    }
    const token = useSession.getState().token;
    const previous = retry.current;
    const requestId = previous && previous.tradeId === current.id && previous.token === token && sameStops(previous.levels, requested)
      ? previous.requestId : randomUUID();
    retry.current = { tradeId: current.id, token, levels: requested, requestId };
    sending.current = true;
    setBusy(true);
    setEditor((state) => state?.tradeId === current.id ? { ...state, error: null } : state);
    try {
      const updated = await postTradeStops(current, requested, requestId, (path, body) =>
        api(path, { method: "POST", body, timeoutMs: STOPS_TIMEOUT_MS, silentRateLimit: true }));
      retry.current = null;
      if (useSession.getState().token !== token) return;
      useSocket.getState().applyStopsResult(updated, before);
      setEditor((state) => state?.tradeId === current.id ? closeStopsDraft(state) : state);
    } catch (error) {
      if (error instanceof ApiError && error.status >= 400 && error.status < 500) retry.current = null;
      if (useSession.getState().token !== token) return;
      setEditor((state) => state?.tradeId === current.id ? { ...state, error: stopsErrorText(error, t) } : state);
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  return {
    tradeId: positionId, mode, levels, draft: draft !== null, busy, error: editor.error,
    disabled: busy || (draft ? !priceReady || (!hasStops(draft) && !hasApplied) : mode === "add" && !priceReady),
    move(side: StopSide, value: number) {
      if (priceReady && price !== null) changeDraft((before) => clampStops({ ...before, [side]: value }, trade, price, precision));
    },
    drop(side: StopSide) {
      if (draft) changeDraft((before) => ({ ...before, [side]: null }));
      else void save({ ...applied, [side]: null }, false);
    },
    cancel() {
      if (!sending.current) setEditor((current) => current?.tradeId === positionId ? closeStopsDraft(current) : current);
    },
    action() {
      if (mode === "add") {
        if (priceReady && price !== null) changeDraft(() => initialStops(trade, price, precision));
      } else if (mode === "remove") void save(EMPTY_STOPS, false);
      else if (draft) void save(draft, true);
    },
  };
}
