/**
 * Whether the app has a usable session right now: hydrated, signed in, and not behind the lock. `locked` is
 * only the lock store's initial guess until `lockLoaded`, so it is not trusted before then. This is the one
 * flag the tab shell opens the socket on and the money queries (`useWallet`, `usePaymentsInfinite`, ...) fetch on.
 */
export function sessionLive(s: { ready: boolean; token: string | null; lockLoaded: boolean; locked: boolean }): boolean {
  return s.ready && s.token !== null && s.lockLoaded && !s.locked;
}
