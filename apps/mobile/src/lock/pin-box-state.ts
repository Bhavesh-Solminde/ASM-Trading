export type PinBoxState = "empty" | "filled" | "error" | "active";

/**
 * Look of box `i` when `length` digits are typed: a typed digit is filled (red while a wrong-PIN message shows), the next
 * box is the active one, the rest are empty. `idle` = no active box (the lock-setup preview).
 */
export function pinBoxState(i: number, length: number, opts: { error: boolean; idle: boolean }): PinBoxState {
  if (i < length) return opts.error ? "error" : "filled";
  return !opts.idle && i === length ? "active" : "empty";
}

/** Whether the red error look is still showing, and which error and entry length it belongs to. */
export interface ErrorLook {
  shown: boolean;
  key: string | number;
  /** Entry length when this error arrived. */
  length: number;
}

/**
 * The red look of a failed PIN lasts only while the entry is as it was when the error arrived; the first digit (or delete)
 * of the next attempt clears it. A new error (another `key`, or the error switched off and on) arms it again.
 * Returns `prev` itself when nothing changed, so it can drive a state update during render.
 */
export function nextErrorLook(prev: ErrorLook | null, error: boolean, key: string | number, length: number): ErrorLook | null {
  if (!error) return null;
  if (prev === null || prev.key !== key) return { shown: true, key, length };
  if (prev.shown && length !== prev.length) return { ...prev, shown: false };
  return prev;
}
