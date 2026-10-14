import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const disk = vi.hoisted(() => new Map<string, string>());
const signOut = vi.hoisted(() => vi.fn());
const fail = vi.hoisted(() => ({ get: new Set<string>(), set: new Set<string>() }));
const auth = vi.hoisted(() => ({ hardware: vi.fn(), enrolled: vi.fn(), authenticate: vi.fn() }));

vi.mock("expo-secure-store", () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1,
  getItemAsync: async (k: string) => {
    if (fail.get.has(k)) throw new Error("keystore read");
    return disk.get(k) ?? null;
  },
  setItemAsync: async (k: string, v: string) => {
    if (fail.set.has(k)) throw new Error("keystore write");
    disk.set(k, v);
  },
  deleteItemAsync: async (k: string) => void disk.delete(k),
}));
vi.mock("expo-crypto", () => ({
  CryptoDigestAlgorithm: { SHA256: "SHA-256" },
  digestStringAsync: async (_a: string, s: string) => createHash("sha256").update(s).digest("hex"),
  randomUUID: () => "11111111-2222-3333-4444-555555555555",
}));
vi.mock("expo-local-authentication", () => ({
  hasHardwareAsync: () => auth.hardware(),
  isEnrolledAsync: () => auth.enrolled(),
  authenticateAsync: () => auth.authenticate(),
}));
vi.mock("i18next", () => ({ default: { t: (k: string) => k } }));
vi.mock("@/auth/session-store", () => ({ useSession: { getState: () => ({ signOut }) } }));

import { useLock } from "./lock-store";

const fresh = {
  enabled: false,
  method: null,
  locked: false,
  skippedThisSession: false,
  attempts: 0,
  backgroundedAt: null,
} as const;

beforeEach(() => {
  disk.clear();
  signOut.mockReset();
  signOut.mockResolvedValue(undefined);
  fail.get.clear();
  fail.set.clear();
  auth.hardware.mockResolvedValue(true);
  auth.enrolled.mockResolvedValue(true);
  auth.authenticate.mockResolvedValue({ success: true });
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

describe("useLock keystore failures", () => {
  it("still counts a wrong PIN when the attempts write fails", async () => {
    await useLock.getState().setPin("1234");
    fail.set.add("ixt.lock.attempts");
    expect(await useLock.getState().verifyPin("0000")).toBe("wrong");
    expect(useLock.getState().attempts).toBe(1);
  });

  it("still logs out on the fifth wrong PIN when the attempts write fails", async () => {
    await useLock.getState().setPin("1234");
    fail.set.add("ixt.lock.attempts");
    for (let i = 0; i < 4; i++) expect(await useLock.getState().verifyPin("0000")).toBe("wrong");
    expect(await useLock.getState().verifyPin("0000")).toBe("logout");
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it("treats an unreadable salt as a wrong PIN instead of rejecting", async () => {
    await useLock.getState().setPin("1234");
    fail.get.add("ixt.lock.salt");
    expect(await useLock.getState().verifyPin("1234")).toBe("wrong");
    expect(useLock.getState()).toMatchObject({ attempts: 1 });
  });

  it("still wipes the lock if sign-out throws", async () => {
    await useLock.getState().setPin("1234");
    signOut.mockRejectedValue(new Error("boom"));
    for (let i = 0; i < 4; i++) await useLock.getState().verifyPin("0000");
    expect(await useLock.getState().verifyPin("0000")).toBe("logout");
    expect(useLock.getState().method).toBeNull();
  });

  it("reads a throwing biometric probe as not available", async () => {
    auth.hardware.mockRejectedValue(new Error("no module"));
    expect(await useLock.getState().enableBiometric()).toBe(false);
    expect(useLock.getState().method).toBeNull();
  });
});

describe("useLock biometric unlock", () => {
  it("clears the persisted wrong-PIN count on success", async () => {
    await useLock.getState().setPin("1234");
    await useLock.getState().verifyPin("0000");
    expect(disk.get("ixt.lock.attempts")).toBe("1");
    expect(await useLock.getState().unlockWithBiometric()).toBe(true);
    expect(disk.has("ixt.lock.attempts")).toBe(false);
    expect(useLock.getState().attempts).toBe(0);
  });

  it("keeps the count when the prompt fails", async () => {
    await useLock.getState().setPin("1234");
    await useLock.getState().verifyPin("0000");
    auth.authenticate.mockResolvedValue({ success: false });
    expect(await useLock.getState().unlockWithBiometric()).toBe(false);
    expect(disk.get("ixt.lock.attempts")).toBe("1");
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

describe("useLock setup skip", () => {
  it("remembers the skip for this run only, and a reset forgets it", async () => {
    useLock.getState().skipSetup();
    expect(useLock.getState().skippedThisSession).toBe(true);
    await useLock.getState().load();
    expect(useLock.getState().skippedThisSession).toBe(true);
    await useLock.getState().reset();
    expect(useLock.getState().skippedThisSession).toBe(false);
  });
});
