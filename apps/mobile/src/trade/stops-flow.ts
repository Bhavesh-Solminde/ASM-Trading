import { OtcSetStopsSchema, type OtcSetStopsInput, type TradeView } from "@asm/contracts";
import { z } from "zod";
import { ApiError, GENERIC_ERROR } from "@/api/errors";
import { TradeViewSchema } from "@/socket/trades";
import { hasStops, initialStops, stopLevels, type StopLevels } from "./otc-protection";

export interface StopsEditor {
  tradeId: string;
  draft: StopLevels | null;
  error: string | null;
}

export function openStopsEditor(trade: TradeView, price: number, precision: number): StopsEditor {
  return { tradeId: trade.id, draft: hasStops(stopLevels(trade)) ? null : initialStops(trade, price, precision), error: null };
}

export function closeStopsDraft(editor: StopsEditor): StopsEditor {
  return { ...editor, draft: null, error: null };
}

export const StopsResultSchema = z.object({ trade: TradeViewSchema });

export async function postTradeStops(
  trade: TradeView,
  levels: StopLevels,
  requestId: string,
  post: (path: string, body: OtcSetStopsInput) => Promise<unknown>,
): Promise<TradeView> {
  const body = OtcSetStopsSchema.parse({ ...levels, requestId });
  const { trade: result } = StopsResultSchema.parse(await post(`/api/trades/${encodeURIComponent(trade.id)}/stops`, body));
  if (result.id !== trade.id || result.accountId !== trade.accountId) throw new Error("Mismatched stops response");
  return result;
}

export function stopsErrorText(error: unknown, t: (key: string) => string): string {
  if (error instanceof ApiError) {
    if (error.code === "offline") return t("common.noConnection");
    if (error.code === "timeout") return t("trade.stops.timedOut");
    if (error.status >= 400 && error.message !== GENERIC_ERROR) return error.message;
  }
  return t("common.genericError");
}
