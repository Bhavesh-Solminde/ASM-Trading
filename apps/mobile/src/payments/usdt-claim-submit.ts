import type { ClaimUsdtPaymentInput } from "@asm/contracts";
import { ApiError } from "@/api/errors";
import { claimErrorText, type ClaimSubmitDeps } from "./claim-submit";
import { sanitizeTxHash, txHashHelp, txHashProblem, usdtClaimBody } from "./usdt-claim";

export interface UsdtClaimSubmitDeps {
  /** POST the validated body to `/api/deposits/:id/usdt-claim` (with `CLAIM_TIMEOUT_MS`); resolves with the raw JSON. */
  post: (body: ClaimUsdtPaymentInput) => Promise<unknown>;
  /** Refetch the checkout the pay screen shows (it carries the stored hash and the status). */
  refreshCheckout: () => void;
  /** Back to the pay screen. */
  leave: () => void;
  /** The message shown where the form is; null clears it. */
  setError: (text: string | null) => void;
  toast: (message: string, tone: "up" | "down") => void;
  /** Identifies the signed-in session (its token); a result that arrives under a different one is dropped. */
  session: () => string | null;
  setBusy: (busy: boolean) => void;
  /** The deposit's network id ("tron" / "bsc"), which words the format message. Read when it is needed. */
  network: () => string | null;
  t: ClaimSubmitDeps["t"];
}

/** Errors something else already reports: the api layer toasts a rate limit, a gate screen replaces the app, and `unauthenticated` signs out. */
const HANDLED_ELSEWHERE = new Set(["rate_limited", "maintenance", "blocked", "upgrade", "unauthenticated"]);

/**
 * The USDT "I already paid" claim, free of React and native modules: the transaction hash, as evidence for the team
 * (it never credits and never changes the deposit's status). Same money-POST rules as the UTR claim: the returned
 * function ignores a call made while another is in flight (a plain variable, so two taps in one frame cannot both
 * pass), NEVER retries, and after a success stays busy because the screen is going away.
 *
 * A timeout or dropped connection refetches the checkout (the hash may have been stored) and toasts a translated
 * "check before trying again". A 409 shows the server's message where the form is and refreshes the checkout: the
 * deposit was credited or closed in the meantime, and the pay screen will say which.
 */
export function createUsdtClaimSubmitter(deps: UsdtClaimSubmitDeps): (hashText: string) => Promise<void> {
  let inFlight = false;
  return async (hashText) => {
    if (inFlight) return;
    const problem = txHashProblem(hashText);
    if (problem) {
      deps.setError(deps.t(problem === "required" ? "usdtClaim.required" : txHashHelp(deps.network()).format));
      return;
    }
    inFlight = true;
    deps.setError(null);
    deps.setBusy(true);
    const session = deps.session();
    let leaving = false;
    try {
      await deps.post(usdtClaimBody(sanitizeTxHash(hashText)));
      if (deps.session() !== session) return;
      leaving = true;
      deps.refreshCheckout();
      deps.toast(deps.t("usdtClaim.sent"), "up");
      deps.leave();
    } catch (e) {
      if (deps.session() !== session) return;
      if (e instanceof ApiError && e.code !== null && HANDLED_ELSEWHERE.has(e.code)) return;
      if (e instanceof ApiError && (e.code === "timeout" || e.code === "offline")) {
        // The server may have stored it: reconcile, and let the user look before trying again.
        deps.refreshCheckout();
        deps.toast(claimErrorText(e, deps.t), "down");
        return;
      }
      if (e instanceof ApiError && e.status === 409) deps.refreshCheckout();
      deps.setError(claimErrorText(e, deps.t));
    } finally {
      inFlight = leaving;
      if (!leaving) deps.setBusy(false);
    }
  };
}
