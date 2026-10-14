/** Longest delay a JS timer reliably takes (a larger one fires at once on React Native). */
export const MAX_TIMER_MS = 2 ** 31 - 1;

export type KeepAwakePlan = { hold: false } | { hold: true; releaseInMs: number };

/**
 * What to do about the screen for an `awakeDeadlineSec` (epoch seconds, or null when nothing is open): hold until
 * the deadline and say how long from `nowMs`, or do not hold at all when there is no deadline or it has passed.
 * Pure, so the decision is tested without a device. The delay is capped to what a timer can run.
 */
export function keepAwakePlan(deadlineSec: number | null, nowMs: number): KeepAwakePlan {
  if (deadlineSec === null) return { hold: false };
  const msLeft = deadlineSec * 1000 - nowMs;
  if (msLeft <= 0) return { hold: false };
  return { hold: true, releaseInMs: Math.min(msLeft, MAX_TIMER_MS) };
}

export interface KeepAwakeDeps {
  activate: () => Promise<void>;
  deactivate: () => Promise<void>;
  /** Called with whatever a native call rejected with; never thrown. */
  onError: (op: "activate" | "deactivate", error: unknown) => void;
}

export interface KeepAwakeLock {
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
    hold: () => enqueue("activate"),
    release: () => enqueue("deactivate"),
    reassert: () => {
      enqueue("deactivate");
      enqueue("activate");
    },
    idle: () => tail,
  };
}
