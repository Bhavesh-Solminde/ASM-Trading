import { ApiError } from "@/api/errors";
import { tradeErrorText } from "./trade-errors";
import { OpenTradeResultSchema, buildOpenTradeBody } from "./trade-request";
import type { OtcOpenTradeInput, OpenTradeResult } from "@asm/contracts";

export interface PendingTrade { body: OtcOpenTradeInput; displayedPrice: number | null }

export interface SubmitDeps {
  onPending?: (pending: PendingTrade | null) => void;
  /** POST the validated body; resolves with the raw JSON. */
  openTrade: (body: OtcOpenTradeInput) => Promise<unknown>;
  applyOpenResult: (result: OpenTradeResult) => void;
  toast: (message: string, tone: "down") => void;
  haptic: () => void;
  invalidateBootstrap: () => void;
  /**
   * Refetches one account's trade list: a bootstrap carries only the demo account's, so it cannot show a LIVE trade.
   * Settles (never rejects) when the list has landed or failed.
   */
  refetchTrades: (accountId: string) => Promise<void> | void;
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
  /** The account's currency as this device knows it: sent as the stale-currency guard, and used in the minimum-stake copy. */
  currency: string;
  displayedPrice?: number;
  quoteToken: string;
  idempotencyKey: string;
  stopLoss?: number | null;
  takeProfit?: number | null;
}

/**
 * Errors something else has already reported: the api layer toasts a rate limit, a gate screen replaces the
 * app for maintenance / blocked / upgrade, and `unauthenticated` signs the user out. A toast on top would be
 * a duplicate or noise.
 */
/** Longest the Dock waits for the trade list after a timed-out open before it frees Up/Down again. */
const RECONCILE_WAIT_MS = 10_000;

const HANDLED_ELSEWHERE = new Set(["rate_limited", "maintenance", "blocked", "upgrade", "unauthenticated"]);

/**
 * The open-trade flow, free of React and native modules. The returned function ignores a call made while
 * another is in flight (plain variable, not state, so two taps in one frame cannot both pass).
 */
export function createSubmitter(deps: SubmitDeps) {
  let inFlight = false;
  let pending: { session: string | null; fingerprint: string; body: OtcOpenTradeInput; displayedPrice: number | null } | null = null;
  let notice: PendingTrade | null = null;
  const notify = () => { notice = pending ? { body: pending.body, displayedPrice: pending.displayedPrice } : null; deps.onPending?.(notice); };
  const submit = async (req: SubmitRequest) => {
    if (inFlight) return;
    inFlight = true;
    deps.setBusy(true);
    deps.haptic();
    const session = deps.session();
    try {
      const fingerprint = JSON.stringify([req.accountId, req.symbol, req.direction, req.stakeMinor, req.durationSec, req.currency, req.stopLoss, req.takeProfit]);
      if (pending && pending.session !== session) { pending = null; notify(); }
      if (pending && pending.fingerprint !== fingerprint) {
        deps.toast(deps.t("trade.retryPrevious"), "down");
        return;
      }
      const body = pending?.body ?? buildOpenTradeBody(req);
      pending = { session, fingerprint, body, displayedPrice: pending?.displayedPrice ?? req.displayedPrice ?? null };
      notify();
      const raw = await deps.openTrade(body);
      // Sign-out (or another user signing in) while the request was in flight: it belongs to nobody now.
      if (deps.session() !== session) return;
      const parsed = OpenTradeResultSchema.safeParse(raw);
      if (parsed.success) {
        deps.applyOpenResult(parsed.data);
        pending = null; notify();
      } else {
        // The server accepted the trade but answered in a shape we cannot read: reconcile from the server.
        deps.invalidateBootstrap();
        deps.refetchTrades(req.accountId);
        deps.toast(deps.t("common.genericError"), "down");
      }
    } catch (e) {
      if (deps.session() !== session) return;
      if (e instanceof ApiError && e.status > 0 && e.status < 500 && e.code !== "timeout") { pending = null; notify(); }
      if (e instanceof ApiError && e.code === "timeout") {
        // No answer in time: reconcile first. A later retry retains this request key and displayed quote.
        // The Dock stays busy until that account's list has landed (capped), so a second tap cannot open a
        // duplicate before the first trade shows up.
        deps.invalidateBootstrap();
        await Promise.race([deps.refetchTrades(req.accountId), new Promise((r) => setTimeout(r, RECONCILE_WAIT_MS))]);
      }
      if (e instanceof ApiError && e.code === "currency_changed") {
        // The account was converted elsewhere: nothing was placed. Learn the new currency and balance, and never
        // resend, since the stake on screen was typed for the old currency. The toast tells the user to check it.
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
  return Object.assign(submit, {
    updateDeps(next: SubmitDeps) { deps = next; },
    pendingTrade() { return pending?.session === deps.session() ? notice : null; },
    hasPending() { return pending?.session === deps.session() && pending !== null; },
    async retryPending() {
      if (!pending || pending.session !== deps.session()) return;
      const p = pending.body;
      await submit({ accountId: p.accountId, symbol: p.symbol, direction: p.direction, stakeMinor: p.stake, durationSec: p.durationSec, currency: p.currency ?? "INR", quoteToken: p.quoteToken, idempotencyKey: p.idempotencyKey, ...(p.stopLoss != null ? { stopLoss: p.stopLoss } : {}), ...(p.takeProfit != null ? { takeProfit: p.takeProfit } : {}) });
    },
  });
}
