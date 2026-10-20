export type PinBoxState = "empty" | "filled" | "error" | "active";

/**
 * Look of box `i` when `length` digits are typed: a typed digit is filled (red while a wrong-PIN message shows), the next
 * box is the active one, the rest are empty. `idle` = no active box (the lock-setup preview).
 */
export function pinBoxState(i: number, length: number, opts: { error: boolean; idle: boolean }): PinBoxState {
  if (i < length) return opts.error ? "error" : "filled";
  return !opts.idle && i === length ? "active" : "empty";
}
