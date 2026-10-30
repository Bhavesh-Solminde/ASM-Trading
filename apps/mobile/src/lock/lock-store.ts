import * as Crypto from "expo-crypto";
import * as LocalAuth from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";
import i18n from "i18next";
import { create } from "zustand";
import { SESSION_KEY } from "@/auth/session-key";
import { useSession } from "@/auth/session-store";
import { hashPin } from "./pin";
import { nextAttempt, parseAttempts, shouldLock } from "./rules";

const K = {
  method: "ixt.lock.method",
  pin: "ixt.lock.pin",
  salt: "ixt.lock.salt",
  off: "ixt.lock.off",
  attempts: "ixt.lock.attempts",
  /** The userId the lock belongs to: a different user signing in on this phone must not inherit it. */
  owner: "ixt.lock.owner",
};
/** Same keychain class as the session token: readable only while the device is unlocked, never migrated. */
const put = (key: string, value: string) =>
  SecureStore.setItemAsync(key, value, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
const sha256 = (s: string) => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, s);

interface LockState {
  enabled: boolean;
  method: "biometric" | "pin" | null;
  locked: boolean;
  /** True once load() has settled (success or fail-closed): until then `locked` is only its initial guess. */
  loaded: boolean;
  /** "Not now" on lock setup; in memory only, so the next cold start offers setup again. */
  skippedThisSession: boolean;
  /** Wrong PINs since the last success; persisted so force-stopping the app cannot reset it. */
  attempts: number;
  backgroundedAt: number | null;
  load: () => Promise<void>;
  enableBiometric: () => Promise<boolean>;
  setPin: (pin: string) => Promise<void>;
  verifyPin: (pin: string) => Promise<"ok" | "wrong" | "logout">;
  /** `promptMessage` replaces the default "Unlock" text where the prompt re-verifies an owner instead (Security). */
  unlockWithBiometric: (promptMessage?: string) => Promise<boolean>;
  onBackground: (now: number) => void;
  onForeground: (now: number) => void;
  /**
   * `userId` just signed in. The cold-start lock guarded the previous session, not this one, so it is
   * cleared; a lock owned by anyone else (or by an unknown owner) is wiped so this user is offered setup.
   */
  startFreshSession: (userId: string) => Promise<void>;
  skipSetup: () => void;
  disable: () => Promise<void>;
  reset: () => Promise<void>;
}

async function prompt(promptMessage: string): Promise<boolean> {
  try {
    const res = await LocalAuth.authenticateAsync({ promptMessage, cancelLabel: i18n.t("common.cancel") });
    return res.success;
  } catch {
    return false;
  }
}

export const useLock = create<LockState>((set, get) => ({
  enabled: false,
  method: null,
  locked: false,
  loaded: false,
  skippedThisSession: false,
  attempts: 0,
  backgroundedAt: null,
  load: async () => {
    let method: string | null = null;
    let off: string | null = null;
    let attempts = 0;
    try {
      const [m, o, a] = await Promise.all([
        SecureStore.getItemAsync(K.method),
        SecureStore.getItemAsync(K.off),
        SecureStore.getItemAsync(K.attempts),
      ]);
      method = m;
      off = o;
      attempts = parseAttempts(a);
    } catch {
      // Fail closed: reading this as "no lock" would offer setup, whose "Not now" opens the app. Locked with
      // no unlock method leaves only "Forgot PIN" (sign out, then log in again).
      set({ method: null, enabled: false, locked: true, loaded: true });
      return;
    }
    const m = method === "biometric" || method === "pin" ? method : null;
    const enabled = m !== null && off !== "1";
    set({
      method: m,
      enabled,
      attempts,
      loaded: true,
      locked: shouldLock({ enabled, coldStart: true, backgroundedAt: null, now: Date.now() }),
    });
  },
  enableBiometric: async () => {
    let available = false;
    try {
      available = (await LocalAuth.hasHardwareAsync()) && (await LocalAuth.isEnrolledAsync());
    } catch {
      // A throwing probe reads as "not available".
    }
    if (!available) return false;
    if (!(await prompt(i18n.t("lock.setupTitle")))) return false;
    await put(K.method, "biometric");
    await SecureStore.deleteItemAsync(K.off);
    set({ method: "biometric", enabled: true, locked: false });
    return true;
  },
  setPin: async (pin) => {
    let salt = await SecureStore.getItemAsync(K.salt);
    if (!salt) {
      salt = Crypto.randomUUID();
      await put(K.salt, salt);
    }
    await put(K.pin, await hashPin(pin, salt, sha256));
    await put(K.method, "pin");
    await SecureStore.deleteItemAsync(K.off);
    await SecureStore.deleteItemAsync(K.attempts);
    set({ method: "pin", enabled: true, locked: false, attempts: 0 });
  },
  verifyPin: async (pin) => {
    let matched = false;
    try {
      const [salt, stored] = await Promise.all([SecureStore.getItemAsync(K.salt), SecureStore.getItemAsync(K.pin)]);
      matched = !!salt && !!stored && (await hashPin(pin, salt, sha256)) === stored;
    } catch {
      // An unreadable keystore never unlocks: it counts as a wrong guess.
    }
    if (matched) {
      await SecureStore.deleteItemAsync(K.attempts).catch(() => {});
      set({ locked: false, attempts: 0 });
      return "ok";
    }
    const next = nextAttempt(get().attempts);
    // Count in memory first so a failing keystore cannot make a guess free.
    set({ attempts: next.attempts });
    // Persist before returning so a force-stop here cannot buy the attacker a free guess.
    await put(K.attempts, String(next.attempts)).catch(() => {});
    if (next.logout) {
      // Sign out first: wiping the lock while the session is still live would leave the app open.
      let signedOut = true;
      try {
        await useSession.getState().signOut();
      } catch {
        signedOut = false;
      }
      // Fail closed: if the sign-out failed or the session token is still live, keep the app locked with its lock
      // intact. The next miss retries the sign-out (the count is already past the limit).
      // The stored token counts too: if the keystore delete failed, wiping the lock now would leave the next cold
      // start signed in with no lock. Unreadable counts as still there.
      let stored: string | null = "unknown";
      try {
        stored = await SecureStore.getItemAsync(SESSION_KEY);
      } catch {
        // keep "unknown"
      }
      if (!signedOut || useSession.getState().token || stored !== null) {
        set({ locked: true });
        return "wrong";
      }
      await get().reset();
      return "logout";
    }
    return "wrong";
  },
  unlockWithBiometric: async (promptMessage) => {
    const ok = await prompt(promptMessage ?? i18n.t("lock.title"));
    if (ok) {
      await SecureStore.deleteItemAsync(K.attempts).catch(() => {});
      set({ locked: false, attempts: 0 });
    }
    return ok;
  },
  onBackground: (now) => set({ backgroundedAt: now }),
  onForeground: (now) => {
    const { enabled, backgroundedAt } = get();
    set({
      backgroundedAt: null,
      ...(shouldLock({ enabled, coldStart: false, backgroundedAt, now }) ? { locked: true } : {}),
    });
  },
  startFreshSession: async (userId) => {
    let owner: string | null = null;
    try {
      owner = await SecureStore.getItemAsync(K.owner);
    } catch {
      // Unknown owner: treat it as someone else's lock.
    }
    if (owner !== userId) {
      await get().reset();
      await put(K.owner, userId).catch(() => {});
    }
    // A password login is stronger proof than the PIN, so a miss count left over from before the session
    // expired does not carry into the new one.
    await SecureStore.deleteItemAsync(K.attempts).catch(() => {});
    set({ locked: false, backgroundedAt: null, attempts: 0 });
  },
  skipSetup: () => set({ skippedThisSession: true }),
  disable: async () => {
    await put(K.off, "1");
    set({ enabled: false, locked: false });
  },
  reset: async () => {
    await Promise.all(Object.values(K).map((k) => SecureStore.deleteItemAsync(k).catch(() => {})));
    set({ enabled: false, method: null, locked: false, skippedThisSession: false, attempts: 0 });
  },
}));
