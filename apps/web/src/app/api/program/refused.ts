import { NextResponse } from "next/server";
import { ProgramActionRefused } from "@asm/db";

/** User-facing text for refusals the repo raises with only a code. */
const MESSAGE: Record<string, string> = {
  insufficient_funds: "That is more than your available earnings.",
  below_minimum: "That is below the minimum withdrawal.",
  limit_day: "You have reached today's withdrawal limit.",
  limit_week: "You have reached this week's withdrawal limit.",
  limit_month: "You have reached this month's withdrawal limit.",
  kyc_required: "Verify your identity first.",
  affiliate_not_active: "Your affiliate account is not active.",
  account_frozen: "Your account is restricted. Contact support.",
  no_live_account: "You need a live trading account to transfer earnings.",
  invalid_state: "This can no longer be done.",
  invalid_amount: "Enter a valid amount.",
  not_found: "Not found.",
};

/**
 * Maps a refused program money action to an HTTP reply with a user-facing message.
 * Anything else is rethrown (a real 500).
 * 404 — unknown id or one owned by someone else (no enumeration).
 * 409 — the record is no longer in a state that allows the action.
 * 400 — every rule refusal (funds, minimum, limits, KYC, affiliate status…).
 */
export function refusedResponse(err: unknown): NextResponse {
  if (!(err instanceof ProgramActionRefused)) throw err;
  const status = err.code === "not_found" ? 404 : err.code === "invalid_state" ? 409 : 400;
  const error = err.message && err.message !== err.code ? err.message : (MESSAGE[err.code] ?? "This action isn't available right now.");
  return NextResponse.json({ error, code: err.code }, { status });
}
