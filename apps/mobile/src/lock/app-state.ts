import { create } from "zustand";
import { useLock } from "./lock-store";
import type { CoverAppState } from "./privacy-cover";

/** The app's foreground state, as the privacy cover reads it. Written only by `onAppStateChange`. */
export const useAppStatus = create<{ appState: CoverAppState }>(() => ({ appState: "active" }));

/**
 * One handler for every AppState change, so the order of the two stores is fixed:
 * - leaving: report "away" FIRST, so the cover is requested before the OS takes its snapshot;
 * - returning: make the relock decision FIRST (`onForeground` is synchronous), and only then report "active".
 *   No render can ever see "active" together with a stale `locked: false` after a long absence, which is what
 *   would flash the old screen for the frames before the gate routes to /lock.
 */
export function onAppStateChange(state: CoverAppState, now: number): void {
  if (state === "active") {
    useLock.getState().onForeground(now);
    useAppStatus.setState({ appState: "active" });
    return;
  }
  useAppStatus.setState({ appState: state });
  if (state === "background") useLock.getState().onBackground(now);
}
