import { create } from "zustand";

/**
 * The account whose full trade list Trade has fetched this session. Trade is the ONE owner of that fetch
 * (`useAccountTradesLoaded`); Payments, History and Account read this store for their header and never fetch,
 * so a switch or a reconnect costs one `GET /api/trades`, not one per mounted tab.
 */
interface ListLoadedStore {
  loadedFor: string | null;
  set: (accountId: string | null) => void;
}

export const useListLoaded = create<ListLoadedStore>()((set) => ({
  loadedFor: null,
  set: (accountId) => set({ loadedFor: accountId }),
}));

/**
 * Whether `accountId`'s trade list is complete: Trade published it, or it is the account whose list bootstrap
 * already carries (`bootstrapTradesAccountId`). False while there is no account.
 */
export function listLoadedFor(loadedFor: string | null, accountId: string | undefined, bootstrapAccountId: string | undefined): boolean {
  if (accountId === undefined) return false;
  return accountId === bootstrapAccountId || loadedFor === accountId;
}
