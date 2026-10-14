import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { useEffect } from "react";
import { useSocket } from "@/socket/socket-store";
import { awakeDeadlineSec } from "./open-trades";

const TAG = "open-trades";

/**
 * Keeps the screen on while at least one trade is open (on any account), so the countdown and the settlement are
 * not missed to a screen timeout. Released as soon as nothing is open, on unmount, and at the latest
 * `AWAKE_GRACE_SEC` after the last open trade's expiry, so a settlement that never arrives cannot hold the screen
 * on forever.
 */
export function useKeepAwakeWhileOpen(): void {
  const deadlineSec = useSocket((s) => awakeDeadlineSec(s.trades.tradesByAccount));
  useEffect(() => {
    if (deadlineSec === null) return;
    const msLeft = deadlineSec * 1000 - Date.now();
    if (msLeft <= 0) return;
    // Keeping the screen on is a nicety: an unsupported device must not turn into an unhandled rejection.
    void activateKeepAwakeAsync(TAG).catch(() => {});
    const release = () => void deactivateKeepAwake(TAG).catch(() => {});
    const timer = setTimeout(release, msLeft);
    return () => {
      clearTimeout(timer);
      release();
    };
  }, [deadlineSec]);
}
