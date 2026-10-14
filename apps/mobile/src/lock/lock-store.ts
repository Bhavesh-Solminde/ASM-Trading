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
    const ok = (await LocalAuth.hasHardwareAsync()) && (await LocalAuth.isEnrolledAsync());
    if (!ok) return false;
    if (!(await prompt(i18n.t("lock.setupTitle")))) return false;
    await SecureStore.setItemAsync(K.method, "biometric");
    await SecureStore.deleteItemAsync(K.off);
    set({ method: "biometric", enabled: true, locked: false });
    return true;
  },
  setPin: async (pin) => {
    let salt = await SecureStore.getItemAsync(K.salt);
    if (!salt) {
      salt = Crypto.randomUUID();
      await SecureStore.setItemAsync(K.salt, salt);
    }
    await SecureStore.setItemAsync(K.pin, await hashPin(pin, salt, sha256));
    await SecureStore.setItemAsync(K.method, "pin");
    await SecureStore.deleteItemAsync(K.off);
    await SecureStore.deleteItemAsync(K.attempts);
    set({ method: "pin", enabled: true, locked: false, attempts: 0 });
  },
  verifyPin: async (pin) => {
    const [salt, stored] = await Promise.all([SecureStore.getItemAsync(K.salt), SecureStore.getItemAsync(K.pin)]);
    if (salt && stored && (await hashPin(pin, salt, sha256)) === stored) {
      await SecureStore.deleteItemAsync(K.attempts);
      set({ locked: false, attempts: 0 });
      return "ok";
    }
    const next = nextAttempt(get().attempts);
    // Persist before anything else so a force-stop here cannot buy the attacker a free guess.
    await SecureStore.setItemAsync(K.attempts, String(next.attempts));
    if (next.logout) {
      // Sign out first: wiping the lock while the session is still live would leave the app open.
      await useSession.getState().signOut();
      await get().reset();
      return "logout";
    }
    set({ attempts: next.attempts });
    return "wrong";
  },
  unlockWithBiometric: async () => {
    const ok = await prompt(i18n.t("lock.title"));
    if (ok) set({ locked: false, attempts: 0 });
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
    await SecureStore.setItemAsync(K.off, "1");
    set({ enabled: false, locked: false });
  },
  reset: async () => {
    await Promise.all(Object.values(K).map((k) => SecureStore.deleteItemAsync(k)));
    set({ enabled: false, method: null, locked: false, attempts: 0 });
  },
}));
