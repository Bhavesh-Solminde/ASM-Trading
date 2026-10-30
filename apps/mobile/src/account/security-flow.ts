import { isValidPin } from "@/lock/pin";
import { MAX_PIN_ATTEMPTS } from "@/lock/rules";

/**
 * The Security screens' decisions, free of React and native modules. The rules they keep:
 *  - the lock never goes off without a fresh check (fingerprint or the current PIN);
 *  - the PIN is never replaced without one either (a deep link straight to the set step is sent to verify first);
 *  - wrong PINs are counted, and the fifth ends the session, by the lock store (`verifyPin`), never here.
 */

export type LockMethod = "biometric" | "pin";
export interface LockSnapshot {
  enabled: boolean;
  method: LockMethod | null;
}

/** The lock is on only when it is enabled and has a method (an enabled lock with no method cannot unlock anything). */
export function lockIsOn(lock: LockSnapshot): boolean {
  return lock.enabled && lock.method !== null;
}

export type ToggleDecision =
  | { kind: "enable-biometric" }
  | { kind: "set-pin" }
  | { kind: "verify-biometric-then-disable" }
  | { kind: "verify-pin-then-disable" };

/**
 * What flipping the "App lock" switch does. Off to on: the fingerprint when the phone has one, else a PIN. On to off:
 * always a verify first, by the method in use. A lock that was switched off keeps its old method in the store, so
 * "off" is judged by `lockIsOn`, not by `method`.
 */
export function decideToggle(lock: LockSnapshot, biometricAvailable: boolean): ToggleDecision {
  if (!lockIsOn(lock)) return biometricAvailable ? { kind: "enable-biometric" } : { kind: "set-pin" };
  return lock.method === "biometric" ? { kind: "verify-biometric-then-disable" } : { kind: "verify-pin-then-disable" };
}

export type DecideNone = { kind: "none" };

/**
 * "Use fingerprint" on a PIN lock. The system fingerprint prompt also takes the phone's own screen-lock PIN, so it
 * proves nothing about the owner of the app lock: the app PIN is verified first, like every other change.
 */
export function decideUseFingerprint(lock: LockSnapshot, biometricAvailable: boolean): { kind: "verify-pin-then-enable-biometric" } | DecideNone {
  return lockIsOn(lock) && lock.method === "pin" && biometricAvailable ? { kind: "verify-pin-then-enable-biometric" } : { kind: "none" };
}

/** "Use a PIN instead" on a fingerprint lock: the biometric (alone, no phone screen-lock fallback) is verified first. */
export function decideUsePin(lock: LockSnapshot): { kind: "verify-biometric-then-set-pin" } | DecideNone {
  return lockIsOn(lock) && lock.method === "biometric" ? { kind: "verify-biometric-then-set-pin" } : { kind: "none" };
}

/**
 * After a biometric check failed or was cancelled: the same step through the app PIN, if a PIN is stored; otherwise
 * null and the lock stays exactly as it was.
 */
export function biometricFailureFallback(next: AfterVerify, pinStored: boolean): AfterVerify | null {
  return pinStored ? next : null;
}

/** Which of the optional rows under the switch show. */
export function lockRows(lock: LockSnapshot, biometricAvailable: boolean): { changePin: boolean; useFingerprint: boolean; usePin: boolean } {
  if (!lockIsOn(lock)) return { changePin: false, useFingerprint: false, usePin: false };
  if (lock.method === "pin") return { changePin: true, useFingerprint: biometricAvailable, usePin: false };
  return { changePin: false, useFingerprint: false, usePin: true };
}

/** After "Use fingerprint": done, or (declined, no sensor, or a failed enrolment check) on to choosing a PIN. */
export function afterEnableBiometric(enabled: boolean): "done" | "set-pin" {
  return enabled ? "done" : "set-pin";
}

export type PinMode = "set" | "verify";
export type AfterVerify = "disable" | "change" | "fingerprint";
export interface PinParams {
  mode: PinMode;
  /** What a verify leads to; always null for a set. */
  next: AfterVerify | null;
  /** A verify by the app PIN although the lock is a fingerprint lock (the fallback after the biometric failed). */
  via: "pin" | null;
}

type Param = string | string[] | undefined;
const first = (v: Param): string | undefined => (Array.isArray(v) ? v[0] : v);

/** The route params of `/account/security-pin`. A verify must say what it is for: there is no default, least of all "turn the lock off". */
export function parsePinParams(raw: { mode?: Param; next?: Param; via?: Param }): PinParams | null {
  const mode = first(raw.mode);
  if (mode === "set") return { mode, next: null, via: null };
  if (mode === "verify") {
    const next = first(raw.next);
    if (next !== "disable" && next !== "change" && next !== "fingerprint") return null;
    return { mode, next, via: first(raw.via) === "pin" ? "pin" : null };
  }
  return null;
}

/** The params to put on the route for a mode (the inverse of `parsePinParams`). */
export function pinParams(mode: PinMode, next?: AfterVerify, via?: "pin"): { mode: PinMode; next?: AfterVerify; via?: "pin" } {
  if (mode !== "verify" || !next) return { mode };
  return via ? { mode, next, via } : { mode, next };
}

/** How long a passed verify lets the PIN be replaced. Shorter than the 5 minutes after which the app relocks. */
export const GRANT_TTL_MS = 120_000;

export function grantFresh(grantedAt: number | null, now: number): boolean {
  return grantedAt !== null && now >= grantedAt && now - grantedAt <= GRANT_TTL_MS;
}

export interface PinScreenStep {
  step: "set" | "verify" | "leave";
  next: AfterVerify | null;
  via: "pin" | null;
}

/**
 * What the PIN screen shows on open. A set while the lock is on needs a fresh verify behind it; without one the
 * screen turns itself into the verify step (so a link straight to the set step cannot replace the PIN). A set while
 * the lock is off is turning it on, which needs nothing.
 */
export function pinScreenStep(params: PinParams | null, lock: LockSnapshot, verified: boolean): PinScreenStep {
  if (params === null) return { step: "leave", next: null, via: null };
  if (params.mode === "set") {
    return lockIsOn(lock) && !verified ? { step: "verify", next: "change", via: null } : { step: "set", next: null, via: null };
  }
  return lockIsOn(lock) ? { step: "verify", next: params.next, via: params.via } : { step: "leave", next: null, via: null };
}

export interface PinEntry {
  step: "enter" | "confirm";
  first: string;
  error: "lock.mismatch" | null;
}
export const initialEntry: PinEntry = { step: "enter", first: "", error: null };

/** One complete 4-digit entry in the set flow: the first PIN moves to confirm; a matching second one is the PIN to save. */
export function submitPin(entry: PinEntry, value: string): { entry: PinEntry; save: string | null } {
  if (!isValidPin(value)) return { entry, save: null };
  if (entry.step === "enter") return { entry: { step: "confirm", first: value, error: null }, save: null };
  if (value === entry.first) return { entry, save: value };
  return { entry: { step: "enter", first: "", error: "lock.mismatch" }, save: null };
}

export type VerifyOutcome = "proceed" | "retry" | "signed-out";
/** `useLock().verifyPin`'s answer as a screen decision. "logout": the store has already signed the user out. */
export function verifyOutcome(result: "ok" | "wrong" | "logout"): VerifyOutcome {
  return result === "ok" ? "proceed" : result === "wrong" ? "retry" : "signed-out";
}

/** Tries left to show after a miss, from the store's persisted count; null before the first miss. */
export function wrongPinCount(attempts: number): number | null {
  if (attempts <= 0) return null;
  return Math.max(0, MAX_PIN_ATTEMPTS - attempts);
}

/** The biometric check on its own (no phone screen-lock fallback: the lock store's `confirmBiometric`). A throw never verifies. */
export async function confirmWithBiometric(deps: { confirm: () => Promise<boolean> }): Promise<"verified" | "not-verified" | "failed"> {
  try {
    return (await deps.confirm()) ? "verified" : "not-verified";
  } catch {
    return "failed";
  }
}

/** Fingerprint path of "turn the lock off": the lock goes off only if the check passed. */
export async function disableWithBiometric(deps: { verify: () => Promise<boolean>; disable: () => Promise<void> }): Promise<"disabled" | "not-verified" | "failed"> {
  const checked = await confirmWithBiometric({ confirm: deps.verify });
  if (checked !== "verified") return checked;
  try {
    await deps.disable();
    return "disabled";
  } catch {
    return "failed";
  }
}

/**
 * After the current PIN was entered correctly: switch the lock off, go on to choose the new PIN, or turn the
 * fingerprint on (the system prompt may still be declined, which leaves the PIN lock as it was).
 */
export async function finishVerify(
  next: AfterVerify,
  deps: { disable: () => Promise<void>; enableBiometric: () => Promise<boolean> },
): Promise<"disabled" | "set-pin" | "fingerprint-on" | "fingerprint-declined" | "failed"> {
  if (next === "change") return "set-pin";
  try {
    if (next === "fingerprint") return (await deps.enableBiometric()) ? "fingerprint-on" : "fingerprint-declined";
    await deps.disable();
    return "disabled";
  } catch {
    return "failed";
  }
}
