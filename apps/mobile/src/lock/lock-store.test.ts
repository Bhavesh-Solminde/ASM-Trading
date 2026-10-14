import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const disk = vi.hoisted(() => new Map<string, string>());
const signOut = vi.hoisted(() => vi.fn());

vi.mock("expo-secure-store", () => ({
  getItemAsync: async (k: string) => disk.get(k) ?? null,
  setItemAsync: async (k: string, v: string) => void disk.set(k, v),
  deleteItemAsync: async (k: string) => void disk.delete(k),
}));
vi.mock("expo-crypto", () => ({
  CryptoDigestAlgorithm: { SHA256: "SHA-256" },
  digestStringAsync: async (_a: string, s: string) => createHash("sha256").update(s).digest("hex"),
  randomUUID: () => "11111111-2222-3333-4444-555555555555",
}));
vi.mock("expo-local-authentication", () => ({
  hasHardwareAsync: async () => true,
  isEnrolledAsync: async () => true,
  authenticateAsync: async () => ({ success: true }),
}));
vi.mock("i18next", () => ({ default: { t: (k: string) => k } }));
vi.mock("@/auth/session-store", () => ({ useSession: { getState: () => ({ signOut }) } }));

import { useLock } from "./lock-store";

const fresh = { enabled: false, method: null, locked: false, attempts: 0, backgroundedAt: null } as const;

beforeEach(() => {
  disk.clear();
  signOut.mockReset();
  signOut.mockResolvedValue(undefined);
  useLock.setState({ ...fresh });
});

describe("useLock PIN attempts", () => {
  it("counts wrong PINs and keeps the count across an app restart", async () => {
    await useLock.getState().setPin("1234");
    expect(await useLock.getState().verifyPin("0000")).toBe("wrong");
    expect(await useLock.getState().verifyPin("1111")).toBe("wrong");
    expect(useLock.getState().attempts).toBe(2);

    // Force-stop: in-memory state is gone, only the keystore survives.
    useLock.setState({ ...fresh });
    await useLock.getState().load();
    expect(useLock.getState()).toMatchObject({ method: "pin", enabled: true, locked: true, attempts: 2 });

    expect(await useLock.getState().verifyPin("2222")).toBe("wrong");
    expect(await useLock.getState().verifyPin("3333")).toBe("wrong");
    expect(await useLock.getState().verifyPin("4444")).toBe("logout");
  });

  it("clears the count on a correct PIN", async () => {
    await useLock.getState().setPin("1234");
    await useLock.getState().verifyPin("0000");
    expect(await useLock.getState().verifyPin("1234")).toBe("ok");
    expect(useLock.getState()).toMatchObject({ locked: false, attempts: 0 });
    useLock.setState({ ...fresh });
    await useLock.getState().load();
    expect(useLock.getState().attempts).toBe(0);
  });

  it("signs out and wipes the lock on the fifth wrong PIN", async () => {
    await useLock.getState().setPin("1234");
    for (let i = 0; i < 4; i++) await useLock.getState().verifyPin("0000");
    expect(await useLock.getState().verifyPin("0000")).toBe("logout");
    expect(signOut).toHaveBeenCalledTimes(1);
    expect([...disk.keys()]).toEqual([]);
    expect(useLock.getState()).toMatchObject({ method: null, enabled: false, attempts: 0 });
  });
});

describe("useLock relock timing", () => {
  it("locks after five minutes in the background and not before", async () => {
    await useLock.getState().setPin("1234");
    useLock.getState().onBackground(1_000);
    useLock.getState().onForeground(1_000 + 60_000);
    expect(useLock.getState().locked).toBe(false);
    useLock.getState().onBackground(1_000);
    useLock.getState().onForeground(1_000 + 300_000);
    expect(useLock.getState().locked).toBe(true);
  });
});
