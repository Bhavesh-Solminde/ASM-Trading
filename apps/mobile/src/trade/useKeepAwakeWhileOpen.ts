import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { useEffect } from "react";

const TAG = "open-trades";

/**
 * Keeps the screen on while at least one trade is open, so the countdown and the settlement are not missed to a
 * screen timeout. Released as soon as nothing is open and when the screen unmounts.
 */
export function useKeepAwakeWhileOpen(hasOpenTrades: boolean): void {
  useEffect(() => {
    if (!hasOpenTrades) return;
    // Keeping the screen on is a nicety: an unsupported device must not turn into an unhandled rejection.
    void activateKeepAwakeAsync(TAG).catch(() => {});
    return () => {
      void deactivateKeepAwake(TAG).catch(() => {});
    };
  }, [hasOpenTrades]);
}
