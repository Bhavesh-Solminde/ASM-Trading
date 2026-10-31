import { z } from "zod";
import type { CreateWithdrawalInput } from "@asm/contracts";
import { ApiError, GENERIC_ERROR } from "@/api/errors";

/** The part of the `POST /api/withdrawals` 201 the app needs: the new withdrawal and whether it was held. */
const CreatedSchema = z.object({ id: z.string().min(1), status: z.string() });

/** A withdrawal POST that gets no answer by then is given up on; the server may still have recorded it (see `api` `timeoutMs`). */
export const WITHDRAW_TIMEOUT_MS = 15_000;

/** Longest a timed-out withdrawal keeps the button busy while the wallet and prefill refetch (as the trade Dock's reconcile wait). */
export const WITHDRAW_RECONCILE_WAIT_MS = 10_000;

type Translate = (key: string, options?: Record<string, unknown>) => string;
type Toast = (message: string, tone: "up" | "down") => void;

/** Errors something else already reports: the api layer toasts a rate limit, a gate screen replaces the app, and `unauthenticated` signs out. */
const HANDLED_ELSEWHERE = new Set(["rate_limited", "maintenance", "blocked", "upgrade", "unauthenticated"]);

/**
 * The text to toast for a failed withdrawal or cancel. offline, timeout and any 5xx are translated; another 4xx shows
 * the server's own message (English, accepted for now: "The minimum withdrawal is ₹700.", "The cancel window has passed.").
 */
export function withdrawErrorText(e: unknown, t: Translate): string {
  if (e instanceof ApiError) {
    // A dropped connection can cut the request mid-flight, so it reads like a timeout: look in Payments before trying again.
    if (e.code === "offline" || e.code === "timeout") return t("withdraw.timedOut");
    if (e.status >= 400 && e.status < 500 && e.message !== GENERIC_ERROR && e.message.trim() !== "") return e.message;
  }
  return t("common.genericError");
}

const isHandledElsewhere = (e: unknown) => e instanceof ApiError && e.code !== null && HANDLED_ELSEWHERE.has(e.code);
/** The request may have reached the server: reconcile from it, never retry. */
const mayHaveLanded = (e: unknown) => e instanceof ApiError && (e.code === "timeout" || e.code === "offline");
const isClientError = (e: unknown) => e instanceof ApiError && e.status >= 400 && e.status < 500;

/** Waits for `work` to settle (resolve or reject) or for `ms` to pass, whichever is first; never rejects, and leaves no timer behind. */
async function settleWithin(work: () => Promise<unknown>, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cap = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ms);
  });
  try {
    await Promise.race([Promise.resolve().then(work).catch(() => undefined), cap]);
  } finally {
    clearTimeout(timer);
  }
}

export interface WithdrawSubmitDeps {
  /** POST the validated body; resolves with the raw JSON. */
  post: (body: CreateWithdrawalInput) => Promise<unknown>;
  invalidateMoney: () => void;
  /** The prefill carries the KYC state, the saved payouts and the held withdrawals, all of which a request can change. */
  invalidatePrefill: () => void;
  /**
   * Settles (never needs to be awaited to completion: it is capped) when the wallet and prefill refetch has landed or
   * failed. After a timeout the button stays busy until then, so a second tap cannot create a second withdrawal
   * before the first one shows up.
   */
  awaitReconcile: () => Promise<unknown>;
  /** Leave the screen for the new withdrawal in History. */
  navigate: (id: string) => void;
  toast: Toast;
  /** Identifies the signed-in session (its token); a result that arrives under a different one is dropped. */
  session: () => string | null;
  setBusy: (busy: boolean) => void;
  t: Translate;
}

/**
 * The money-moving withdrawal request, free of React and native modules. The returned function ignores a call made
 * while another is in flight (a plain variable, not state, so two taps in one frame cannot both pass) and NEVER
 * retries: a request that timed out may have been recorded, so it refetches the money and prefill queries and tells
 * the user to look in Payments instead. After a success it stays busy on purpose: the screen is being replaced, and a
 * tap during that transition must not send a second withdrawal.
 */
export function createWithdrawSubmitter(deps: WithdrawSubmitDeps): (body: CreateWithdrawalInput) => Promise<void> {
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
        // The server may have accepted it but answered in a shape we cannot read: reconcile, and say to look.
        deps.invalidateMoney();
        deps.invalidatePrefill();
        deps.toast(deps.t("withdraw.unclear"), "down");
        return;
      }
      created = true;
      deps.toast(deps.t(parsed.data.status === "HELD" ? "withdraw.heldToast" : "withdraw.requested"), "up");
      deps.invalidateMoney();
      deps.invalidatePrefill();
      deps.navigate(parsed.data.id);
    } catch (e) {
      if (deps.session() !== session) return;
      if (isHandledElsewhere(e)) return;
      if (mayHaveLanded(e)) deps.invalidateMoney();
      // A refusal can mean the gate moved (KYC) or the saved payouts did: refetch the prefill the screen is built on.
      if (mayHaveLanded(e) || isClientError(e)) deps.invalidatePrefill();
      deps.toast(withdrawErrorText(e, deps.t), "down");
      // The request may have been recorded: stay busy until the refetch shows it (capped), so a tap cannot double it.
      if (mayHaveLanded(e)) await settleWithin(deps.awaitReconcile, WITHDRAW_RECONCILE_WAIT_MS);
    } finally {
      inFlight = created;
      if (!created) deps.setBusy(false);
    }
  };
}

export interface CancelSubmitDeps {
  /** POST `/api/withdrawals/:id/cancel`; resolves with the raw JSON (not read: the refetch carries the refund). */
  post: (id: string) => Promise<unknown>;
  invalidateMoney: () => void;
  invalidatePrefill: () => void;
  toast: Toast;
  session: () => string | null;
  /** The withdrawal being cancelled, or null when none is. */
  setBusyId: (id: string | null) => void;
  t: Translate;
}

/**
 * Cancelling a held withdrawal: a money-moving POST under the same rules (15 s timeout, one at a time across every
 * held box, never retried). A 4xx (the window passed, it was already reviewed) shows the server's message and refetches
 * the prefill, so the screen re-reads the row (it may have moved on). The Cancel button itself is hidden from the
 * row's `cancelableUntil` (see `canCancelHeld`), not by this refetch: a row still HELD stays in the list.
 */
export function createCancelSubmitter(deps: CancelSubmitDeps): (id: string) => Promise<void> {
  let inFlight = false;
  return async (id) => {
    if (inFlight) return;
    inFlight = true;
    deps.setBusyId(id);
    const session = deps.session();
    try {
      await deps.post(id);
      if (deps.session() !== session) return;
      deps.invalidateMoney();
      deps.invalidatePrefill();
      deps.toast(deps.t("withdraw.cancelled"), "up");
    } catch (e) {
      if (deps.session() !== session) return;
      if (isHandledElsewhere(e)) return;
      if (mayHaveLanded(e)) deps.invalidateMoney();
      if (mayHaveLanded(e) || isClientError(e)) deps.invalidatePrefill();
      deps.toast(withdrawErrorText(e, deps.t), "down");
    } finally {
      inFlight = false;
      deps.setBusyId(null);
    }
  };
}
