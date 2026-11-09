import { create } from "zustand";
import { EMPTY_PROTECTION, type Protection } from "./otc-protection";

export const useProtection = create<{
  key: string;
  draft: Protection;
  set: (key: string, draft: Protection) => void;
}>((set) => ({ key: "", draft: EMPTY_PROTECTION, set: (key, draft) => set({ key, draft }) }));
export function protectionFor(key: string) {
  const state = useProtection.getState();
  return state.key === key ? state.draft : EMPTY_PROTECTION;
}

/** Clear only the submitted draft; edits made while the request was in flight belong to the next trade. */
export function clearAcceptedProtection(trade: { accountId: string; symbol: string; direction: string; stopLoss?: number | null; takeProfit?: number | null }) {
  const state = useProtection.getState();
  if (state.key === `${trade.accountId}:${trade.symbol}` && state.draft.direction === trade.direction && state.draft.stopLoss === trade.stopLoss && state.draft.takeProfit === trade.takeProfit) {
    state.set(state.key, EMPTY_PROTECTION);
  }
}
