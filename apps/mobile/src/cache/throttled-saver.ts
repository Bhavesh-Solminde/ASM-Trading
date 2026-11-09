/**
 * Trailing-edge throttle for best-effort cache writes. `schedule` keeps only the newest builder and
 * saves once per window; `cancel` drops anything pending (sign-out); `flush` saves right now (backgrounding).
 * The value is built when the timer fires, so it reflects the latest state, and a builder returning null
 * means "nothing worth saving" (e.g. signed out).
 */
export interface ThrottledSaver<T> {
  schedule: (build: () => T | null) => void;
  flush: (build: () => T | null) => void;
  cancel: () => void;
}

export function createThrottledSaver<T>({
  intervalMs,
  save,
}: {
  intervalMs: number;
  save: (value: T) => void;
}): ThrottledSaver<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let latest: (() => T | null) | null = null;

  const run = (build: () => T | null) => {
    try {
      const value = build();
      if (value !== null) save(value);
    } catch {
      // A failed cache write must never reach the caller; the next window tries again.
    }
  };

  const cancel = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    latest = null;
  };

  return {
    schedule: (build) => {
      latest = build;
      if (timer !== null) return;
      timer = setTimeout(() => {
        const build = latest;
        timer = null;
        latest = null;
        if (build) run(build);
      }, intervalMs);
    },
    flush: (build) => {
      cancel();
      run(build);
    },
    cancel,
  };
}
