import { ApiError, GENERIC_ERROR } from "@/api/errors";

/** A reset that gets no answer by then is given up on; the server may still have done it (see `api` `timeoutMs`). */
export const DEMO_RESET_TIMEOUT_MS = 15_000;

type Translate = (key: string) => string;
type Toast = (message: string, tone: "up" | "down") => void;

/** Errors something else already reports: a rate limit toasts, a gate screen replaces the app, `unauthenticated` signs out. */
const HANDLED_ELSEWHERE = new Set(["rate_limited", "maintenance", "blocked", "upgrade", "unauthenticated"]);

/**
 * The text to toast for a failed reset. offline and timeout read as "check your demo balance" (the request may have
 * landed); 5xx and a bare error are generic; another 4xx shows the server's own message (English, accepted for now).
 */
export function demoResetErrorText(e: unknown, t: Translate): string {
  if (e instanceof ApiError) {
    if (e.code === "offline" || e.code === "timeout") return t("account.demoResetTimedOut");
    if (e.status >= 400 && e.status < 500 && e.message !== GENERIC_ERROR && e.message.trim() !== "") return e.message;
  }
  return t("common.genericError");
}

export interface DemoResetDeps {
  /** POST `/api/account/demo-balance { accountId }` (no amount: the server resets to the currency's default). */
  post: (accountId: string) => Promise<unknown>;
  /** Refetch the bootstrap (`refreshBootstrap`), whose balances the trade header and Payments read. */
  refresh: () => void;
  toast: Toast;
  /** Identifies the signed-in session (its token); a result that arrives under a different one is dropped. */
  session: () => string | null;
  setBusy: (busy: boolean) => void;
  t: Translate;
}

/**
 * The demo reset, a money-moving POST under the P3 rules, free of React and native modules: one at a time (a plain
 * variable, so two taps in one frame cannot both pass), a 15 s timeout set by the caller's `post`, and never retried.
 * After a timeout it refreshes anyway (the reset may have landed) and says to look before trying again.
 */
export function createDemoResetSubmitter(deps: DemoResetDeps): (accountId: string) => Promise<void> {
  let inFlight = false;
  return async (accountId) => {
    if (inFlight) return;
    inFlight = true;
    deps.setBusy(true);
    const session = deps.session();
    try {
      await deps.post(accountId);
      if (deps.session() !== session) return;
      deps.refresh();
      deps.toast(deps.t("account.demoResetDone"), "up");
    } catch (e) {
      if (deps.session() !== session) return;
      if (e instanceof ApiError && e.code !== null && HANDLED_ELSEWHERE.has(e.code)) return;
      if (e instanceof ApiError && (e.code === "timeout" || e.code === "offline")) deps.refresh();
      deps.toast(demoResetErrorText(e, deps.t), "down");
    } finally {
      inFlight = false;
      deps.setBusy(false);
    }
  };
}
