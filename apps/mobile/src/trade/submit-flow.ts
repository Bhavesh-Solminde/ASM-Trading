import { ApiError } from "@/api/errors";
import { tradeErrorKey } from "./trade-errors";
import { OpenTradeResultSchema, buildOpenTradeBody } from "./trade-request";
import type { OpenTradeInput, OpenTradeResult } from "@asm/contracts";

export interface SubmitDeps {
  /** POST the validated body; resolves with the raw JSON. */
  openTrade: (body: OpenTradeInput) => Promise<unknown>;
  applyOpenResult: (result: OpenTradeResult) => void;
  toast: (message: string, tone: "down") => void;
  haptic: () => void;
  invalidateBootstrap: () => void;
  setBusy: (busy: boolean) => void;
  t: (key: string) => string;
}

export interface SubmitRequest {
  accountId: string;
  symbol: string;
  direction: "UP" | "DOWN";
  stakeMinor: number;
  durationSec: number;
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
    try {
      const body = buildOpenTradeBody(req);
      const parsed = OpenTradeResultSchema.safeParse(await deps.openTrade(body));
      if (parsed.success) {
        deps.applyOpenResult(parsed.data);
      } else {
        // The server accepted the trade but answered in a shape we cannot read: reconcile from bootstrap.
        deps.invalidateBootstrap();
        deps.toast(deps.t("common.genericError"), "down");
      }
    } catch (e) {
      if (!(e instanceof ApiError && e.code !== null && HANDLED_ELSEWHERE.has(e.code))) {
        deps.toast(deps.t(tradeErrorKey(e)), "down");
      }
    } finally {
      inFlight = false;
      deps.setBusy(false);
    }
  };
}
