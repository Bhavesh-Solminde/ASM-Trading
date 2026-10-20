import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const disk = vi.hoisted(() => new Map<string, string>());
const signOut = vi.hoisted(() => vi.fn());
const session = vi.hoisted(() => ({ token: null as string | null }));
const fail = vi.hoisted(() => ({ get: new Set<string>(), set: new Set<string>(), del: new Set<string>(), delAll: false }));
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
  deleteItemAsync: async (k: string) => {
    if (fail.delAll || fail.del.has(k)) throw new Error("keystore delete");
    disk.delete(k);
  },
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
vi.mock("@/auth/session-store", () => ({ useSession: { getState: () => ({ signOut, token: session.token }) } }));

import { useLock } from "./lock-store";

const fresh = {
  enabled: false,
  method: null,
  locked: false,
  loaded: false,
  skippedThisSession: false,
  attempts: 0,
  backgroundedAt: null,
} as const;

beforeEach(() => {
  disk.clear();
  signOut.mockReset();
  signOut.mockResolvedValue(undefined);
  session.token = null;
  fail.get.clear();
  fail.set.clear();
  fail.del.clear();
  fail.delAll = false;
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

describe("useLock logout ordering", () => {
  it("signs out while the lock keys are still on disk, and wipes them only afterwards", async () => {
    await useLock.getState().setPin("1234");
    const seenAtSignOut: boolean[] = [];
    signOut.mockImplementation(async () => {
      // Wiping first would leave a live session with no lock for the length of the sign-out.
      seenAtSignOut.push(disk.has("ixt.lock.pin"), disk.has("ixt.lock.method"));
    });
    for (let i = 0; i < 4; i++) await useLock.getState().verifyPin("0000");
    expect(await useLock.getState().verifyPin("0000")).toBe("logout");
    expect(seenAtSignOut).toEqual([true, true]);
    expect(disk.has("ixt.lock.pin")).toBe(false);
  });
});

describe("useLock reset", () => {
  it("completes and clears the in-memory lock even when every keystore delete fails", async () => {
    await useLock.getState().setPin("1234");
    useLock.getState().skipSetup();
    fail.delAll = true;
    await expect(useLock.getState().reset()).resolves.toBeUndefined();
    expect(useLock.getState()).toMatchObject({
      enabled: false,
      method: null,
      locked: false,
      skippedThisSession: false,
      attempts: 0,
    });
  });

  it("still completes the fifth-wrong-PIN logout when the wipe fails", async () => {
    await useLock.getState().setPin("1234");
    fail.del.add("ixt.lock.pin");
    for (let i = 0; i < 4; i++) await useLock.getState().verifyPin("0000");
    expect(await useLock.getState().verifyPin("0000")).toBe("logout");
    expect(useLock.getState().method).toBeNull();
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

  it("fails closed when sign-out throws: the app stays locked with its lock intact, and the next miss retries the sign-out", async () => {
    await useLock.getState().setPin("1234");
    useLock.setState({ locked: true });
    signOut.mockRejectedValue(new Error("boom"));
    for (let i = 0; i < 4; i++) await useLock.getState().verifyPin("0000");
    expect(await useLock.getState().verifyPin("0000")).toBe("wrong");
    expect(useLock.getState()).toMatchObject({ locked: true, method: "pin", enabled: true });
    expect(disk.has("ixt.lock.pin")).toBe(true);
    signOut.mockResolvedValue(undefined);
    expect(await useLock.getState().verifyPin("0000")).toBe("logout");
    expect(signOut).toHaveBeenCalledTimes(2);
    expect(useLock.getState().method).toBeNull();
  });

  it("fails closed when the stored session token survived the sign-out (keystore delete failed)", async () => {
    await useLock.getState().setPin("1234");
    useLock.setState({ locked: true });
    disk.set("ixt.session", "persisted");
    for (let i = 0; i < 4; i++) await useLock.getState().verifyPin("0000");
    expect(await useLock.getState().verifyPin("0000")).toBe("wrong");
    expect(useLock.getState()).toMatchObject({ locked: true, method: "pin", enabled: true });
    expect(disk.has("ixt.lock.pin")).toBe(true);
  });

  it("fails closed when the stored session token cannot be read after the sign-out", async () => {
    await useLock.getState().setPin("1234");
    useLock.setState({ locked: true });
    fail.get.add("ixt.session");
    for (let i = 0; i < 4; i++) await useLock.getState().verifyPin("0000");
    expect(await useLock.getState().verifyPin("0000")).toBe("wrong");
    expect(useLock.getState()).toMatchObject({ locked: true, method: "pin" });
  });

  it("fails closed when sign-out resolves but the session token is still live", async () => {
    await useLock.getState().setPin("1234");
    useLock.setState({ locked: true });
    session.token = "still-here";
    for (let i = 0; i < 4; i++) await useLock.getState().verifyPin("0000");
    expect(await useLock.getState().verifyPin("0000")).toBe("wrong");
    expect(useLock.getState()).toMatchObject({ locked: true, method: "pin" });
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

describe("useLock owner", () => {
  it("offers lock setup to a different user instead of inheriting the previous user's PIN", async () => {
    await useLock.getState().startFreshSession("user-a");
    await useLock.getState().setPin("1234");
    // A signs out (the lock keys stay), B signs in on the same phone.
    await useLock.getState().startFreshSession("user-b");
    expect(useLock.getState()).toMatchObject({ method: null, enabled: false, locked: false, attempts: 0 });
    expect(disk.has("ixt.lock.pin")).toBe(false);
    expect(disk.get("ixt.lock.owner")).toBe("user-b");
    // Nor does B's next cold start ask for A's PIN.
    useLock.setState({ ...fresh });
    await useLock.getState().load();
    expect(useLock.getState()).toMatchObject({ method: null, locked: false });
  });

  it("a password sign-in resets the persisted wrong-PIN count (it is stronger proof than the PIN)", async () => {
    await useLock.getState().startFreshSession("user-a");
    await useLock.getState().setPin("1234");
    await useLock.getState().verifyPin("0000");
    await useLock.getState().verifyPin("0000");
    await useLock.getState().verifyPin("0000");
    expect(disk.get("ixt.lock.attempts")).toBe("3");
    await useLock.getState().startFreshSession("user-a");
    expect(useLock.getState().attempts).toBe(0);
    expect(disk.has("ixt.lock.attempts")).toBe(false);
  });

  it("keeps the lock when the same user signs in again (e.g. after a server-side expiry)", async () => {
    await useLock.getState().startFreshSession("user-a");
    await useLock.getState().setPin("1234");
    await useLock.getState().startFreshSession("user-a");
    expect(useLock.getState()).toMatchObject({ method: "pin", enabled: true, locked: false });
  });

  it("resets a lock with no recorded owner (set up before owners existed)", async () => {
    await useLock.getState().setPin("1234");
    disk.delete("ixt.lock.owner");
    await useLock.getState().startFreshSession("user-a");
    expect(useLock.getState().method).toBeNull();
  });

  it("resets the lock when the owner cannot be read", async () => {
    await useLock.getState().startFreshSession("user-a");
    await useLock.getState().setPin("1234");
    fail.get.add("ixt.lock.owner");
    await useLock.getState().startFreshSession("user-a");
    expect(useLock.getState().method).toBeNull();
  });
});

describe("useLock loaded flag", () => {
  it("is false until load() settles, then true", async () => {
    expect(useLock.getState().loaded).toBe(false);
    await useLock.getState().load();
    expect(useLock.getState().loaded).toBe(true);
  });

  it("is true after a failed load too (the lock state is known: fail-closed)", async () => {
    fail.get.add("ixt.lock.method");
    await useLock.getState().load();
    expect(useLock.getState()).toMatchObject({ loaded: true, locked: true });
  });

  it("survives a reset", async () => {
    await useLock.getState().load();
    await useLock.getState().reset();
    expect(useLock.getState().loaded).toBe(true);
  });
});

describe("useLock load failure", () => {
  it("fails closed: an unreadable keystore locks with no unlock method instead of offering setup", async () => {
    await useLock.getState().setPin("1234");
    useLock.setState({ ...fresh });
    fail.get.add("ixt.lock.method");
    await useLock.getState().load();
    expect(useLock.getState()).toMatchObject({ locked: true, method: null });
  });
});

describe("useLock fresh session", () => {
  it("locks a cold start, and a new sign-in clears that lock without disabling it", async () => {
    await useLock.getState().startFreshSession("user-a");
    await useLock.getState().setPin("1234");
    useLock.setState({ ...fresh });
    await useLock.getState().load();
    expect(useLock.getState().locked).toBe(true);
    await useLock.getState().startFreshSession("user-a");
    expect(useLock.getState()).toMatchObject({ locked: false, enabled: true, method: "pin" });
    // The next background cycle still relocks the new session.
    useLock.getState().onBackground(1_000);
    useLock.getState().onForeground(1_000 + 300_000);
    expect(useLock.getState().locked).toBe(true);
  });

  it("still locks a cold start that has a stored session (nothing clears it)", async () => {
    await useLock.getState().setPin("1234");
    useLock.setState({ ...fresh });
    await useLock.getState().load();
    expect(useLock.getState()).toMatchObject({ locked: true, enabled: true });
  });
});
