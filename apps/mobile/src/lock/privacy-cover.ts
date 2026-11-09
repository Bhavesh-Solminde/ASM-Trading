import type { GateRoute } from "@/gate/route-for";

/** The app-state values that matter here: anything but `active`/`unknown` means the window may be snapshotted. */
export type CoverAppState = "active" | "background" | "inactive" | "unknown" | "extension";

/**
 * Whether the opaque privacy cover must be drawn over the whole app.
 *
 * - Away (background / inactive) with the lock on: yes, so the Android recents thumbnail and any app-switcher
 *   snapshot taken as the app leaves is the cover, not the account. With the lock off nothing would ever
 *   relock the app, so the cover is not worth blanking the screen for.
 * - Back in the foreground: only while a relock is in flight, i.e. the app is `locked` but the route is not yet
 *   `/lock`. The relock decision has already been made by then (see `onAppStateChange`), so with no relock due
 *   this is false on the very first frame.
 */
export function shouldCover(s: { appState: CoverAppState; lockEnabled: boolean; locked: boolean; onLockRoute: boolean }): boolean {
  const away = s.appState === "background" || s.appState === "inactive";
  if (away) return s.lockEnabled;
  return s.locked && !s.onLockRoute;
}

/**
 * True when no navigation to /lock is outstanding: the gate wants a different screen (signed out, maintenance,
 * forced update, splash, nothing) or the app is already on /lock. `locked` alone must not hold the cover up in
 * those cases, because /lock is never coming.
 */
export function lockRouteReached(target: GateRoute | null, pathname: string): boolean {
  return target !== "/lock" || pathname === "/lock";
}
