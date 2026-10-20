import { ApiError } from "@/api/errors";
import { tradeErrorText } from "./trade-errors";
import { OpenTradeResultSchema, buildOpenTradeBody } from "./trade-request";
import type { OpenTradeInput, OpenTradeResult } from "@asm/contracts";

export interface SubmitDeps {
  /** POST the validated body; resolves with the raw JSON. */
  openTrade: (body: OpenTradeInput) => Promise<unknown>;
  applyOpenResult: (result: OpenTradeResult) => void;
  toast: (message: string, tone: "down") => void;
  haptic: () => void;
  invalidateBootstrap: () => void;
  /** Refetches one account's trade list: a bootstrap carries only the demo account's, so it cannot show a LIVE trade. */
  refetchTrades: (accountId: string) => void;
  /** Identifies the signed-in session (its token); a result that arrives under a different one is dropped. */
  session: () => string | null;
  setBusy: (busy: boolean) => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}

export interface SubmitRequest {
  accountId: string;
  symbol: string;
  direction: "UP" | "DOWN";
  stakeMinor: number;
  durationSec: number;
  /** The account's currency (for the minimum-stake copy). */
  currency: string;
}

/**
 * Errors something else has already reported: the api layer toasts a rate limit, a gate screen replaces the
 * app for maintenance / blocked / upgrade, and `unauthenticated` signs the user out. A toast on top would be
 * a duplicate or noise.
 */
const HANDLED_ELSEWHERE = new Set(["rate_limited", "maintenance", "blocked", "upgrade", "unauthenticated"]);

/**
 * The open-trade flow, free of React and native modules. The returned function ignores a call made while
 * another is in flight (plain variable, not state, so two taps in one frame cannot both pass).
 */
export function createSubmitter(deps: SubmitDeps): (req: SubmitRequest) => Promise<void> {
  let inFlight = false;
  return async (req) => {
    if (inFlight) return;
    inFlight = true;
    deps.setBusy(true);
    deps.haptic();
    const session = deps.session();
    try {
      const body = buildOpenTradeBody(req);
      const raw = await deps.openTrade(body);
      // Sign-out (or another user signing in) while the request was in flight: it belongs to nobody now.
      if (deps.session() !== session) return;
      const parsed = OpenTradeResultSchema.safeParse(raw);
      if (parsed.success) {
        deps.applyOpenResult(parsed.data);
      } else {
        // The server accepted the trade but answered in a shape we cannot read: reconcile from the server.
        deps.invalidateBootstrap();
        deps.refetchTrades(req.accountId);
        deps.toast(deps.t("common.genericError"), "down");
      }
    } catch (e) {
      if (deps.session() !== session) return;
      if (e instanceof ApiError && e.code === "timeout") {
        // No answer in time: the trade may have been placed, so never retry; reconcile and point at Your trades.
        deps.invalidateBootstrap();
        deps.refetchTrades(req.accountId);
      }
      if (!(e instanceof ApiError && e.code !== null && HANDLED_ELSEWHERE.has(e.code))) {
        deps.toast(tradeErrorText(e, req.currency, deps.t), "down");
      }
    } finally {
      inFlight = false;
      deps.setBusy(false);
    }
  };
}
