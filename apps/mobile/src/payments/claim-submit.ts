import type { ClaimUtrInput } from "@asm/contracts";
import { ApiError, GENERIC_ERROR } from "@/api/errors";
import { claimBody, sanitizeUtr, utrProblem } from "./utr";

/** A claim that gets no answer by then is given up on; the server may still have recorded it (see `api` `timeoutMs`). */
export const CLAIM_TIMEOUT_MS = 15_000;

export interface ClaimSubmitDeps {
  /** POST the validated body to `/api/deposits/:id/claim`; resolves with the raw JSON. */
  post: (body: ClaimUtrInput) => Promise<unknown>;
  invalidateMoney: () => void;
  /** Refetch the checkout the pay screen shows (its status and `claimedUtr`). */
  refreshCheckout: () => void;
  /** Back to the pay screen. */
  leave: () => void;
  /** The message shown where the form is; null clears it. */
  setError: (text: string | null) => void;
  toast: (message: string, tone: "down") => void;
  /** Identifies the signed-in session (its token); a result that arrives under a different one is dropped. */
  session: () => string | null;
  setBusy: (busy: boolean) => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}

/** Errors something else already reports: the api layer toasts a rate limit, a gate screen replaces the app, and `unauthenticated` signs out. */
const HANDLED_ELSEWHERE = new Set(["rate_limited", "maintenance", "blocked", "upgrade", "unauthenticated"]);

/**
 * The text for a failed claim. offline, timeout and any 5xx are translated; another 4xx shows the server's own
 * message (English, accepted for now: "A reference has already been submitted for this deposit.").
 */
export function claimErrorText(e: unknown, t: ClaimSubmitDeps["t"]): string {
  if (e instanceof ApiError) {
    if (e.code === "offline") return t("common.noConnection");
    if (e.code === "timeout") return t("claim.timedOut");
    if (e.status >= 400 && e.status < 500 && e.message !== GENERIC_ERROR && e.message.trim() !== "") return e.message;
  }
  return t("common.genericError");
}

/**
 * The money-moving UTR claim, free of React and native modules. The returned function ignores a call made while
 * another is in flight (a plain variable, not state, so two taps in one frame cannot both pass) and NEVER retries:
 * a claim that timed out may have been recorded, so it refetches the money and checkout queries and tells the user
 * to look instead. After a success (or "the matcher already settled it") it stays busy on purpose: the screen is
 * going away and a tap during that must not send a second claim.
 */
export function createClaimSubmitter(deps: ClaimSubmitDeps): (utrText: string) => Promise<void> {
  let inFlight = false;
  return async (utrText) => {
    if (inFlight) return;
    const problem = utrProblem(sanitizeUtr(utrText));
    if (problem) {
      deps.setError(deps.t(`claim.${problem}`));
      return;
    }
    inFlight = true;
    deps.setError(null);
    deps.setBusy(true);
    const session = deps.session();
    let leaving = false;
    try {
      await deps.post(claimBody(utrText));
      if (deps.session() !== session) return;
      leaving = true;
      deps.invalidateMoney();
      deps.refreshCheckout();
      deps.leave();
    } catch (e) {
      if (deps.session() !== session) return;
      if (e instanceof ApiError && e.status === 409 && e.resolved) {
        // The payment was matched while the form was open: the pay screen shows the result.
        leaving = true;
        deps.invalidateMoney();
        deps.refreshCheckout();
        deps.leave();
        return;
      }
      if (e instanceof ApiError && e.code !== null && HANDLED_ELSEWHERE.has(e.code)) return;
      if (e instanceof ApiError && (e.code === "timeout" || e.code === "offline")) {
        // The server may have recorded it: reconcile, and let the user look before trying again.
        deps.invalidateMoney();
        deps.refreshCheckout();
        deps.toast(claimErrorText(e, deps.t), "down");
        return;
      }
      // A 409 means a claim already exists: the pay screen should show it.
      if (e instanceof ApiError && e.status === 409) deps.refreshCheckout();
      deps.setError(claimErrorText(e, deps.t));
    } finally {
      inFlight = leaving;
      if (!leaving) deps.setBusy(false);
    }
  };
}
