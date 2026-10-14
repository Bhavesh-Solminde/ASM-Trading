import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { useEffect } from "react";
import { AppState } from "react-native";
import { useSocket } from "@/socket/socket-store";
import { createKeepAwakeLock, foregroundAction, keepAwakePlan } from "./keep-awake-lock";
import { awakeDeadlineSec } from "./open-trades";

const TAG = "open-trades";

/** A rejected native call means the screen is NOT being held; say so in development instead of failing silently. */
const lock = createKeepAwakeLock({
  activate: () => activateKeepAwakeAsync(TAG),
  deactivate: () => deactivateKeepAwake(TAG),
  onError: (op, error) => {
    // Dev-only diagnostics for a native call that cannot be surfaced to the user.
    if (__DEV__) console.warn(`[keep-awake] ${op} failed`, error);
  },
});

/**
 * Keeps the screen on while at least one trade is open (on any account), so the countdown and the settlement are
 * not missed to a screen timeout. Released as soon as nothing is open, on unmount, and at the latest
 * `AWAKE_GRACE_SEC` after the last open trade's expiry, so a settlement that never arrives cannot hold the screen
 * on forever. Coming back to the foreground re-applies the hold (the window flag is per activity, and
 * expo-keep-awake does not re-add it when its tag is already registered).
 */
export function useKeepAwakeWhileOpen(): void {
  const deadlineSec = useSocket((s) => awakeDeadlineSec(s.trades.tradesByAccount));
  useEffect(() => {
    const plan = keepAwakePlan(deadlineSec, Date.now());
    if (!plan.hold) return;
    if (__DEV__) console.log(`[keep-awake] holding the screen for ${Math.round(plan.releaseInMs / 1000)}s`);
    lock.hold();
    const timer = setTimeout(lock.release, plan.releaseInMs);
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      if (foregroundAction(deadlineSec, Date.now()) === "reassert") lock.reassert();
      else lock.release();
    });
    return () => {
      clearTimeout(timer);
      sub.remove();
      lock.release();
    };
  }, [deadlineSec]);
}
