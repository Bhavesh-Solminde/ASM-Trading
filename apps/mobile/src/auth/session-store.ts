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
    const token = get().token;
    if (!token) return Promise.resolve();
    signingOut = (async () => {
      try {
        // Local first: plain fetch has no timeout, so a stalled network must not hold the user signed in.
        await SecureStore.deleteItemAsync(KEY).catch(() => {});
        queryClient.clear();
        set({ token: null });
      } finally {
        signingOut = null;
      }
      // Best effort in the background, with the captured token since the session no longer holds it.
      if (remote) void api("/api/auth/logout", { method: "POST", token }).catch(() => {});
    })();
    return signingOut;
  },
}));

configureApi({
  token: () => useSession.getState().token,
  logout: () => void useSession.getState().signOut({ remote: false }),
  toast,
});
