import * as Crypto from "expo-crypto";
import * as LocalAuth from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";
import i18n from "i18next";
import { create } from "zustand";
import { useSession } from "@/auth/session-store";
import { hashPin } from "./pin";
import { nextAttempt, parseAttempts, shouldLock } from "./rules";

const K = {
  method: "ixt.lock.method",
  pin: "ixt.lock.pin",
  salt: "ixt.lock.salt",
  off: "ixt.lock.off",
  attempts: "ixt.lock.attempts",
};
/** Same keychain class as the session token: readable only while the device is unlocked, never migrated. */
const put = (key: string, value: string) =>
  SecureStore.setItemAsync(key, value, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
const sha256 = (s: string) => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, s);

interface LockState {
  enabled: boolean;
  method: "biometric" | "pin" | null;
  locked: boolean;
  /** Wrong PINs since the last success; persisted so force-stopping the app cannot reset it. */
  attempts: number;
  backgroundedAt: number | null;
  load: () => Promise<void>;
  enableBiometric: () => Promise<boolean>;
  setPin: (pin: string) => Promise<void>;
  verifyPin: (pin: string) => Promise<"ok" | "wrong" | "logout">;
  unlockWithBiometric: () => Promise<boolean>;
  onBackground: (now: number) => void;
  onForeground: (now: number) => void;
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
      // An unreadable keystore reads as no lock; the session token lives in the same keystore.
    }
    const m = method === "biometric" || method === "pin" ? method : null;
    const enabled = m !== null && off !== "1";
    set({
      method: m,
      enabled,
      attempts,
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
      await useSession.getState().signOut().catch(() => {});
      await get().reset();
      return "logout";
    }
    return "wrong";
  },
  unlockWithBiometric: async () => {
    const ok = await prompt(i18n.t("lock.title"));
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
  disable: async () => {
    await put(K.off, "1");
    set({ enabled: false, locked: false });
  },
  reset: async () => {
    await Promise.all(Object.values(K).map((k) => SecureStore.deleteItemAsync(k).catch(() => {})));
    set({ enabled: false, method: null, locked: false, attempts: 0 });
  },
}));
