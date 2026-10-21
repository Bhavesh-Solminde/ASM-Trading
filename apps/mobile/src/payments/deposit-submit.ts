import { z } from "zod";
import type { CreateDepositInput } from "@asm/contracts";
import { ApiError, GENERIC_ERROR } from "@/api/errors";

/** The `POST /api/deposits` answer: the checkout the pay screen opens. */
const CreatedSchema = z.object({ checkoutToken: z.string().min(1) });

/** A deposit POST that gets no answer by then is given up on; see `api` `timeoutMs`. The server may still have created it. */
export const CREATE_DEPOSIT_TIMEOUT_MS = 15_000;

export interface DepositSubmitDeps {
  /** POST the validated body; resolves with the raw JSON. */
  post: (body: CreateDepositInput) => Promise<unknown>;
  /** Remember the checkout (per user) so Payments can offer "Continue". */
  savePending: (token: string) => void;
  invalidateMoney: () => void;
  navigate: (token: string) => void;
  toast: (message: string, tone: "down") => void;
  /** Identifies the signed-in session (its token); a result that arrives under a different one is dropped. */
  session: () => string | null;
  setBusy: (busy: boolean) => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}

/** Errors something else already reports: the api layer toasts a rate limit, a gate screen replaces the app, and `unauthenticated` signs out. */
const HANDLED_ELSEWHERE = new Set(["rate_limited", "maintenance", "blocked", "upgrade", "unauthenticated"]);

/**
 * The text to toast for a failed deposit call. offline, timeout and any 5xx are translated; another 4xx shows the
 * server's own message (English, accepted for now: it can say a TRON slot is busy for "about 3 minutes").
 */
export function depositErrorText(e: unknown, t: DepositSubmitDeps["t"]): string {
  if (e instanceof ApiError) {
    if (e.code === "offline") return t("common.noConnection");
    if (e.code === "timeout") return t("deposit.timedOut");
    if (e.status >= 400 && e.status < 500 && e.message !== GENERIC_ERROR && e.message.trim() !== "") return e.message;
    // The route's own 503s ("USDT on X is temporarily unavailable", "coming soon"): say it in the user's language.
    if (e.status === 503 && e.code === null && e.message !== GENERIC_ERROR && e.message.trim() !== "") return t("deposit.unavailable");
  }
  return t("common.genericError");
}

/**
 * The money-moving create-deposit flow, free of React and native modules. The returned function ignores a call made
 * while another is in flight (a plain variable, not state, so two taps in one frame cannot both pass), and NEVER
 * retries: a request that timed out may have created the deposit, so it refetches the money queries and tells the
 * user to look in Payments instead. After a success it stays busy on purpose: the screen is being replaced, and a
 * tap during that transition must not create a second deposit.
 */
export function createDepositSubmitter(deps: DepositSubmitDeps): (body: CreateDepositInput) => Promise<void> {
  let inFlight = false;
  return async (body) => {
    if (inFlight) return;
    inFlight = true;
    deps.setBusy(true);
    const session = deps.session();
    let created = false;
    try {
      const raw = await deps.post(body);
      // Sign-out (or another user signing in) while the request was in flight: it belongs to nobody now.
      if (deps.session() !== session) return;
      const parsed = CreatedSchema.safeParse(raw);
      if (!parsed.success) {
        // The server may have accepted it but answered in a shape we cannot read: reconcile from the server.
        deps.invalidateMoney();
        deps.toast(deps.t("common.genericError"), "down");
        return;
      }
      created = true;
      deps.savePending(parsed.data.checkoutToken);
      deps.invalidateMoney();
      deps.navigate(parsed.data.checkoutToken);
    } catch (e) {
      if (deps.session() !== session) return;
      // Either may have happened after the server created the deposit: reconcile, never retry.
      if (e instanceof ApiError && (e.code === "timeout" || e.code === "offline")) deps.invalidateMoney();
      if (!(e instanceof ApiError && e.code !== null && HANDLED_ELSEWHERE.has(e.code))) {
        deps.toast(depositErrorText(e, deps.t), "down");
      }
    } finally {
      inFlight = created;
      if (!created) deps.setBusy(false);
    }
  };
}
