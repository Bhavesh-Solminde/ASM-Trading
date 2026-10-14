import { useMemo } from "react";
import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";
import { openMmkv } from "@/cache/mmkv";
import { parsePersisted, prefsFor, withPrefs, type PrefsByUser, type UserPrefs } from "./prefs-model";

interface PrefsStore {
  byUser: PrefsByUser;
  setFor: (userId: string, partial: Partial<UserPrefs>) => void;
}

/** MMKV-backed, opened on first read/write; with no native module it degrades to in-memory prefs. */
const storage: StateStorage = {
  getItem: (k) => {
    try {
      return openMmkv("ixt-prefs")?.getString(k) ?? null;
    } catch {
      return null;
    }
  },
  setItem: (k, v) => {
    try {
      openMmkv("ixt-prefs")?.set(k, v);
    } catch {
      // Losing a pref write only forgets a choice.
    }
  },
  removeItem: (k) => {
    try {
      openMmkv("ixt-prefs")?.remove(k);
    } catch {
      // Best effort.
    }
  },
};

export const useTradePrefs = create<PrefsStore>()(
  persist(
    (set) => ({
      byUser: {},
      setFor: (userId, partial) => set((s) => ({ byUser: withPrefs(s.byUser, userId, partial) })),
    }),
    {
      name: "trade-prefs",
      version: 1,
      storage: createJSONStorage(() => storage),
      partialize: (s) => ({ byUser: s.byUser }),
      merge: (persisted, current) => ({
        ...current,
        byUser: parsePersisted((persisted as { byUser?: unknown } | null | undefined)?.byUser),
      }),
    },
  ),
);

/**
 * One user's prefs plus a setter. Chart type, market, timeframe, favourites, stake and expiry are saved
 * per user, so a second account on the same phone never inherits them. `userId` null (not known yet)
 * reads defaults and ignores writes.
 */
export function useUserPrefs(userId: string | null): UserPrefs & { set: (partial: Partial<UserPrefs>) => void } {
  const mine = useTradePrefs((s) => prefsFor(s.byUser, userId));
  const setFor = useTradePrefs((s) => s.setFor);
  return useMemo(
    () => ({
      ...mine,
      set: (partial: Partial<UserPrefs>) => {
        if (userId) setFor(userId, partial);
      },
    }),
    [mine, userId, setFor],
  );
}
