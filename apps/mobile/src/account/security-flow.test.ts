import { describe, expect, it, vi } from "vitest";
import { MAX_PIN_ATTEMPTS } from "@/lock/rules";
import {
  GRANT_TTL_MS,
  afterEnableBiometric,
  decideToggle,
  disableWithBiometric,
  finishVerify,
  grantFresh,
  initialEntry,
  lockIsOn,
  lockRows,
  parsePinParams,
  pinParams,
  pinScreenStep,
  reverifyVia,
  submitPin,
  verifyOutcome,
  wrongPinCount,
  type LockSnapshot,
} from "./security-flow";

const OFF: LockSnapshot = { enabled: false, method: null };
const OFF_STALE_PIN: LockSnapshot = { enabled: false, method: "pin" };
const PIN: LockSnapshot = { enabled: true, method: "pin" };
const BIO: LockSnapshot = { enabled: true, method: "biometric" };

describe("lockIsOn", () => {
  it("is on only when enabled with a method (the Account hub reads the same rule)", () => {
    expect(lockIsOn(PIN)).toBe(true);
    expect(lockIsOn(BIO)).toBe(true);
    expect(lockIsOn(OFF)).toBe(false);
    expect(lockIsOn(OFF_STALE_PIN)).toBe(false);
    expect(lockIsOn({ enabled: true, method: null })).toBe(false);
  });
});

describe("decideToggle", () => {
  it("turning it on tries the fingerprint when the phone has one, else goes to the PIN screen", () => {
    expect(decideToggle(OFF, true)).toEqual({ kind: "enable-biometric" });
    expect(decideToggle(OFF, false)).toEqual({ kind: "set-pin" });
    // A switch that was turned off keeps its old method in the store; turning it on again starts fresh.
    expect(decideToggle(OFF_STALE_PIN, true)).toEqual({ kind: "enable-biometric" });
    expect(decideToggle(OFF_STALE_PIN, false)).toEqual({ kind: "set-pin" });
  });

  it("turning it off always re-verifies first, by the method the lock uses", () => {
    expect(decideToggle(PIN, true)).toEqual({ kind: "verify-pin-then-disable" });
    expect(decideToggle(PIN, false)).toEqual({ kind: "verify-pin-then-disable" });
    expect(decideToggle(BIO, true)).toEqual({ kind: "verify-biometric-then-disable" });
    expect(decideToggle(BIO, false)).toEqual({ kind: "verify-biometric-then-disable" });
  });

  it("never offers a decision that switches the lock off without a verify step", () => {
    for (const lock of [PIN, BIO]) for (const bio of [true, false]) expect(decideToggle(lock, bio).kind).toMatch(/^verify-/);
  });
});

describe("reverifyVia", () => {
  it("is the method the lock is on", () => {
    expect(reverifyVia(PIN)).toBe("pin");
    expect(reverifyVia(BIO)).toBe("biometric");
  });
});

describe("lockRows", () => {
  it("shows nothing while the lock is off", () => {
    expect(lockRows(OFF, true)).toEqual({ changePin: false, useFingerprint: false, usePin: false });
    expect(lockRows(OFF_STALE_PIN, true)).toEqual({ changePin: false, useFingerprint: false, usePin: false });
  });

  it("on a PIN lock: Change PIN, and Use fingerprint only if the phone can", () => {
    expect(lockRows(PIN, true)).toEqual({ changePin: true, useFingerprint: true, usePin: false });
    expect(lockRows(PIN, false)).toEqual({ changePin: true, useFingerprint: false, usePin: false });
  });

  it("on a fingerprint lock: only 'use a PIN instead'", () => {
    expect(lockRows(BIO, true)).toEqual({ changePin: false, useFingerprint: false, usePin: true });
    expect(lockRows(BIO, false)).toEqual({ changePin: false, useFingerprint: false, usePin: true });
  });
});

describe("afterEnableBiometric", () => {
  it("falls back to the PIN screen when the fingerprint was declined or unavailable", () => {
    expect(afterEnableBiometric(true)).toBe("done");
    expect(afterEnableBiometric(false)).toBe("set-pin");
  });
});

describe("parsePinParams", () => {
  it("reads set and verify, and the step a verify leads to", () => {
    expect(parsePinParams({ mode: "set" })).toEqual({ mode: "set", next: null });
    expect(parsePinParams({ mode: "verify", next: "disable" })).toEqual({ mode: "verify", next: "disable" });
    expect(parsePinParams({ mode: "verify", next: "change" })).toEqual({ mode: "verify", next: "change" });
  });

  it("takes the first value of a repeated param", () => {
    expect(parsePinParams({ mode: ["verify", "set"], next: ["change", "disable"] })).toEqual({ mode: "verify", next: "change" });
  });

  it("rejects an unknown or missing mode", () => {
    expect(parsePinParams({})).toBeNull();
    expect(parsePinParams({ mode: "disable" })).toBeNull();
    expect(parsePinParams({ mode: "" })).toBeNull();
    expect(parsePinParams({ mode: [] })).toBeNull();
  });

  it("a verify with no (or an unknown) next has nothing to lead to: it does not default to turning the lock off", () => {
    expect(parsePinParams({ mode: "verify" })).toBeNull();
    expect(parsePinParams({ mode: "verify", next: "wipe" })).toBeNull();
  });

  it("ignores next on a set", () => {
    expect(parsePinParams({ mode: "set", next: "disable" })).toEqual({ mode: "set", next: null });
  });

  it("round-trips through pinParams", () => {
    for (const [mode, next] of [["set", undefined], ["verify", "disable"], ["verify", "change"]] as const) {
      expect(parsePinParams(pinParams(mode, next))).toEqual({ mode, next: next ?? null });
    }
  });
});

describe("grantFresh", () => {
  it("is fresh for two minutes after the verify", () => {
    expect(GRANT_TTL_MS).toBe(120_000);
    expect(grantFresh(1_000, 1_000)).toBe(true);
    expect(grantFresh(1_000, 1_000 + GRANT_TTL_MS)).toBe(true);
    expect(grantFresh(1_000, 1_001 + GRANT_TTL_MS)).toBe(false);
  });
  it("is never fresh without a verify, or when the clock went backwards", () => {
    expect(grantFresh(null, 5)).toBe(false);
    expect(grantFresh(10_000, 5_000)).toBe(false);
  });
});

describe("pinScreenStep (what /account/security-pin does when it opens)", () => {
  it("a set on a live lock without a fresh verify is sent to verify first, so a deep link cannot change the PIN", () => {
    expect(pinScreenStep({ mode: "set", next: null }, PIN, false)).toEqual({ step: "verify", next: "change" });
    expect(pinScreenStep({ mode: "set", next: null }, BIO, false)).toEqual({ step: "verify", next: "change" });
  });

  it("a set after a fresh verify, or while the lock is off (turning it on), goes ahead", () => {
    expect(pinScreenStep({ mode: "set", next: null }, PIN, true)).toEqual({ step: "set", next: null });
    expect(pinScreenStep({ mode: "set", next: null }, OFF, false)).toEqual({ step: "set", next: null });
    expect(pinScreenStep({ mode: "set", next: null }, OFF_STALE_PIN, false)).toEqual({ step: "set", next: null });
  });

  it("a verify on a live lock stays a verify and keeps its next", () => {
    expect(pinScreenStep({ mode: "verify", next: "disable" }, PIN, false)).toEqual({ step: "verify", next: "disable" });
    expect(pinScreenStep({ mode: "verify", next: "change" }, PIN, true)).toEqual({ step: "verify", next: "change" });
  });

  it("a verify with no live lock has nothing to verify: leave", () => {
    expect(pinScreenStep({ mode: "verify", next: "disable" }, OFF, false)).toEqual({ step: "leave", next: null });
  });

  it("unreadable params leave", () => {
    expect(pinScreenStep(null, PIN, true)).toEqual({ step: "leave", next: null });
  });
});

describe("submitPin (enter, confirm, save)", () => {
  it("ignores a PIN that is not four digits", () => {
    for (const v of ["", "12", "123", "12a4", "12345"]) expect(submitPin(initialEntry, v)).toEqual({ entry: initialEntry, save: null });
  });

  it("the first PIN moves to confirm", () => {
    expect(submitPin(initialEntry, "4821")).toEqual({ entry: { step: "confirm", first: "4821", error: null }, save: null });
  });

  it("a matching confirm saves", () => {
    const { entry } = submitPin(initialEntry, "4821");
    expect(submitPin(entry, "4821").save).toBe("4821");
  });

  it("a mismatch goes back to the start with the mismatch message and saves nothing", () => {
    const { entry } = submitPin(initialEntry, "4821");
    expect(submitPin(entry, "4822")).toEqual({ entry: { step: "enter", first: "", error: "lock.mismatch" }, save: null });
  });

  it("a fresh first PIN clears the mismatch message", () => {
    const { entry } = submitPin(submitPin(initialEntry, "1111").entry, "2222");
    expect(entry.error).toBe("lock.mismatch");
    expect(submitPin(entry, "3333").entry).toEqual({ step: "confirm", first: "3333", error: null });
  });
});

describe("verifyOutcome and wrongPinCount", () => {
  it("ok proceeds, wrong retries, logout means the store already signed the user out", () => {
    expect(verifyOutcome("ok")).toBe("proceed");
    expect(verifyOutcome("wrong")).toBe("retry");
    expect(verifyOutcome("logout")).toBe("signed-out");
  });

  it("shows the tries left from the store's persisted count, and nothing before the first miss", () => {
    expect(wrongPinCount(0)).toBeNull();
    expect(wrongPinCount(1)).toBe(MAX_PIN_ATTEMPTS - 1);
    expect(wrongPinCount(MAX_PIN_ATTEMPTS - 1)).toBe(1);
    expect(wrongPinCount(MAX_PIN_ATTEMPTS)).toBe(0);
    expect(wrongPinCount(MAX_PIN_ATTEMPTS + 3)).toBe(0);
    expect(wrongPinCount(-1)).toBeNull();
  });
});

describe("disableWithBiometric", () => {
  it("switches the lock off only after the fingerprint check passed", async () => {
    const verify = vi.fn(async () => true);
    const disable = vi.fn(async () => {});
    expect(await disableWithBiometric({ verify, disable })).toBe("disabled");
    expect(disable).toHaveBeenCalledTimes(1);
    expect(verify.mock.invocationCallOrder[0]).toBeLessThan(disable.mock.invocationCallOrder[0] as number);
  });

  it("a declined or failed check leaves the lock on", async () => {
    const disable = vi.fn(async () => {});
    expect(await disableWithBiometric({ verify: async () => false, disable })).toBe("not-verified");
    expect(disable).not.toHaveBeenCalled();
  });

  it("a check that throws leaves the lock on", async () => {
    const disable = vi.fn(async () => {});
    expect(
      await disableWithBiometric({
        verify: async () => {
          throw new Error("sensor");
        },
        disable,
      }),
    ).toBe("failed");
    expect(disable).not.toHaveBeenCalled();
  });

  it("reports a failed switch-off (keystore write) as failed, not as done", async () => {
    expect(
      await disableWithBiometric({
        verify: async () => true,
        disable: async () => {
          throw new Error("keystore write");
        },
      }),
    ).toBe("failed");
  });
});

describe("finishVerify (what happens after the PIN was right)", () => {
  it("disable switches the lock off", async () => {
    const disable = vi.fn(async () => {});
    expect(await finishVerify("disable", { disable })).toBe("disabled");
    expect(disable).toHaveBeenCalledTimes(1);
  });

  it("change goes on to the set step and switches nothing off", async () => {
    const disable = vi.fn(async () => {});
    expect(await finishVerify("change", { disable })).toBe("set-pin");
    expect(disable).not.toHaveBeenCalled();
  });

  it("a failed switch-off is reported", async () => {
    expect(
      await finishVerify("disable", {
        disable: async () => {
          throw new Error("keystore write");
        },
      }),
    ).toBe("failed");
  });
});
