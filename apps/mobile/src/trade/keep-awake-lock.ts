import { TRADE_DURATIONS_SEC } from "@asm/contracts";
import { AWAKE_GRACE_SEC } from "./open-trades";

/** Longest delay a JS timer reliably takes (a larger one fires at once on React Native). */
export const MAX_TIMER_MS = 2 ** 31 - 1;

/**
 * Longest the screen is ever held: the longest trade plus the grace. A legitimate deadline is never further away,
 * so a device clock running behind the server cannot keep the screen on for its whole offset.
 */
export const MAX_HOLD_MS = Math.min((Math.max(...TRADE_DURATIONS_SEC) + AWAKE_GRACE_SEC) * 1000, MAX_TIMER_MS);

export type KeepAwakePlan = { hold: false } | { hold: true; releaseInMs: number };

/**
 * What to do about the screen for an `awakeDeadlineSec` (epoch seconds, or null when nothing is open): hold until
 * the deadline and say how long from `nowMs`, or do not hold at all when there is no deadline or it has passed.
 * Pure, so the decision is tested without a device. The delay is capped to `MAX_HOLD_MS`.
 */
export function keepAwakePlan(deadlineSec: number | null, nowMs: number): KeepAwakePlan {
  if (deadlineSec === null) return { hold: false };
  const msLeft = deadlineSec * 1000 - nowMs;
  if (msLeft <= 0) return { hold: false };
  return { hold: true, releaseInMs: Math.min(msLeft, MAX_HOLD_MS) };
}

/**
 * What coming back to the foreground does: re-apply the hold while a deadline is still ahead, otherwise release,
 * which is idempotent and drops a tag a failed earlier release may have left behind.
 */
export function foregroundAction(deadlineSec: number | null, nowMs: number): "reassert" | "release" {
  return keepAwakePlan(deadlineSec, nowMs).hold ? "reassert" : "release";
}

export interface KeepAwakeDeps {
  activate: () => Promise<void>;
  deactivate: () => Promise<void>;
  /** Called with whatever a native call rejected with; never thrown. */
  onError: (op: "activate" | "deactivate", error: unknown) => void;
}

export interface KeepAwakeLock {
  /** Clears our tag, then adds it: a stale tag (a failed release) would otherwise make the add a no-op. */
  hold: () => void;
  release: () => void;
  /** Release then hold again: re-applies the window flag to whichever activity is current now. */
  reassert: () => void;
  /** Resolves once everything queued so far has finished (for tests). */
  idle: () => Promise<void>;
}

/**
 * Serialises the native activate/deactivate calls. They are asynchronous native calls, so two issued back to back
 * (an effect cleanup's release followed by the next effect's hold) are otherwise free to run in either order and
 * leave the flag in the wrong state. A rejection is reported to `onError` and the queue carries on.
 */
export function createKeepAwakeLock(deps: KeepAwakeDeps): KeepAwakeLock {
  let tail: Promise<void> = Promise.resolve();
  const enqueue = (op: "activate" | "deactivate") => {
    tail = tail.then(() =>
      deps[op]().catch((error: unknown) => {
        deps.onError(op, error);
      }),
    );
  };
  return {
    hold: () => {
      enqueue("deactivate");
      enqueue("activate");
    },
    release: () => enqueue("deactivate"),
    reassert: () => {
      enqueue("deactivate");
      enqueue("activate");
    },
    idle: () => tail,
  };
}
