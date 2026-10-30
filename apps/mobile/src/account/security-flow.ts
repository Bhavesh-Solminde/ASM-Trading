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

export type Reverify = "biometric" | "pin";
/** How the owner is asked to confirm a sensitive change: by the method the lock already uses. */
export function reverifyVia(lock: LockSnapshot): Reverify {
  return lock.method === "biometric" ? "biometric" : "pin";
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
export type AfterVerify = "disable" | "change";
export interface PinParams {
  mode: PinMode;
  /** What a verify leads to; always null for a set. */
  next: AfterVerify | null;
}

type Param = string | string[] | undefined;
const first = (v: Param): string | undefined => (Array.isArray(v) ? v[0] : v);

/** The route params of `/account/security-pin`. A verify must say what it is for: there is no default, least of all "turn the lock off". */
export function parsePinParams(raw: { mode?: Param; next?: Param }): PinParams | null {
  const mode = first(raw.mode);
  if (mode === "set") return { mode, next: null };
  if (mode === "verify") {
    const next = first(raw.next);
    return next === "disable" || next === "change" ? { mode, next } : null;
  }
  return null;
}

/** The params to put on the route for a mode (the inverse of `parsePinParams`). */
export function pinParams(mode: PinMode, next?: AfterVerify): { mode: PinMode; next?: AfterVerify } {
  return mode === "verify" && next ? { mode, next } : { mode };
}

/** How long a passed verify lets the PIN be replaced. Shorter than the 5 minutes after which the app relocks. */
export const GRANT_TTL_MS = 120_000;

export function grantFresh(grantedAt: number | null, now: number): boolean {
  return grantedAt !== null && now >= grantedAt && now - grantedAt <= GRANT_TTL_MS;
}

export interface PinScreenStep {
  step: "set" | "verify" | "leave";
  next: AfterVerify | null;
}

/**
 * What the PIN screen shows on open. A set while the lock is on needs a fresh verify behind it; without one the
 * screen turns itself into the verify step (so a link straight to the set step cannot replace the PIN). A set while
 * the lock is off is turning it on, which needs nothing.
 */
export function pinScreenStep(params: PinParams | null, lock: LockSnapshot, verified: boolean): PinScreenStep {
  if (params === null) return { step: "leave", next: null };
  if (params.mode === "set") {
    return lockIsOn(lock) && !verified ? { step: "verify", next: "change" } : { step: "set", next: null };
  }
  return lockIsOn(lock) ? { step: "verify", next: params.next } : { step: "leave", next: null };
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

/** Fingerprint path of "turn the lock off": the lock goes off only if the check passed. */
export async function disableWithBiometric(deps: { verify: () => Promise<boolean>; disable: () => Promise<void> }): Promise<"disabled" | "not-verified" | "failed"> {
  try {
    if (!(await deps.verify())) return "not-verified";
    await deps.disable();
    return "disabled";
  } catch {
    return "failed";
  }
}

/** After the current PIN was entered correctly: switch the lock off, or go on to choose the new PIN. */
export async function finishVerify(next: AfterVerify, deps: { disable: () => Promise<void> }): Promise<"disabled" | "set-pin" | "failed"> {
  if (next === "change") return "set-pin";
  try {
    await deps.disable();
    return "disabled";
  } catch {
    return "failed";
  }
}
