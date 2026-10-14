import * as SecureStore from "expo-secure-store";
import { create } from "zustand";
import { api, configureApi } from "@/api/client";
import { queryClient } from "@/api/queries";
import { toast } from "@/ui/Toast";

const KEY = "ixt.session";

interface SessionState {
  token: string | null;
  ready: boolean;
  hydrate: () => Promise<void>;
  signIn: (token: string) => Promise<void>;
  signOut: (opts?: { remote?: boolean }) => Promise<void>;
}

/** The sign-out in flight, so overlapping `unauthenticated` responses share one logout. */
let signingOut: Promise<void> | null = null;

export const useSession = create<SessionState>((set, get) => ({
  token: null,
  ready: false,
  hydrate: async () => {
    let token: string | null = null;
    try {
      token = await SecureStore.getItemAsync(KEY);
    } catch {
      // An unreadable keystore reads as signed out; the user can log in again.
    }
    set({ token, ready: true });
  },
  signIn: async (token) => {
    await SecureStore.setItemAsync(KEY, token, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
    set({ token });
  },
  signOut: ({ remote = true } = {}) => {
    if (signingOut) return signingOut;
    if (!get().token) return Promise.resolve();
    signingOut = (async () => {
      try {
        // The token stays set during the remote call so the request carries it.
        if (remote) await api("/api/auth/logout", { method: "POST" }).catch(() => {});
        await SecureStore.deleteItemAsync(KEY).catch(() => {});
        queryClient.clear();
        set({ token: null });
      } finally {
        signingOut = null;
      }
    })();
    return signingOut;
  },
}));

configureApi({
  token: () => useSession.getState().token,
  logout: () => void useSession.getState().signOut({ remote: false }),
  toast,
});
