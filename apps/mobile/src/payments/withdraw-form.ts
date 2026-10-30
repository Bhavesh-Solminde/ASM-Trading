import type { AmountOpts } from "@asm/client-core";
import {
  CreateWithdrawalSchema,
  PayoutDetailsSchema,
  withdrawalLimitsMinor,
  type CreateWithdrawalInput,
  type PayoutDetails,
  type PayoutMethod,
  USDT_NETWORK_INFO,
  type UsdtNetwork,
  type WithdrawalPrefill,
} from "@asm/contracts";

/**
 * The withdraw screen's pure logic. It holds no English text: the screen turns problems into i18n keys.
 * Every amount is an integer in the account's minor units; none of it goes through a float. An INR account takes whole
 * rupees (the keypad has no point), a USD account takes cents, as on the website.
 */

/** The keypad's rules: whole rupees on INR (at most 8 digits, more than the ₹50,000 limit so "too much" still reads as a limit), cents elsewhere. */
export function withdrawAmountOpts(currency: string): AmountOpts {
  return currency === "INR" ? { decimals: false, maxInt: 8 } : { decimals: true, maxInt: 7 };
}

/**
 * The typed amount as minor units, read digit by digit (never `Number("0.29") * 100`). 0 for nothing, for text that
 * is not a plain amount, and for one with more places than the account has.
 */
export function parseAmountMinor(text: string, currency: string): number {
  const match = currency === "INR" ? /^(\d+)$/.exec(text) : /^(\d+)(?:\.(\d{0,2}))?$/.exec(text);
  if (!match) return 0;
  const whole = Number(match[1]);
  const cents = currency === "INR" ? 0 : Number((match[2] ?? "").padEnd(2, "0"));
  const minor = whole * 100 + cents;
  return Number.isSafeInteger(minor) ? minor : 0;
}

/** Minor units back to keypad text ("8200", "123.5"); empty for nothing. The inverse of `parseAmountMinor` for amounts the account can hold. */
export function amountTextFromMinor(minor: number, currency: string): string {
  if (!Number.isSafeInteger(minor) || minor <= 0) return "";
  const whole = Math.floor(minor / 100);
  const cents = minor % 100;
  if (currency === "INR" || cents === 0) return String(whole);
  return `${whole}.${String(cents).padStart(2, "0").replace(/0$/, "")}`;
}

/**
 * The most one request can take: the withdrawable balance, capped at the per-request limit, and (on INR) floored to
 * whole rupees because the keypad takes none of the paise. Never negative.
 */
export function maxWithdrawMinor(withdrawable: number, currency: string): number {
  const capped = Math.min(withdrawable, withdrawalLimitsMinor(currency).max);
  if (!Number.isFinite(capped) || capped <= 0) return 0;
  return currency === "INR" ? Math.floor(capped / 100) * 100 : Math.floor(capped);
}

export type AmountProblem = "min" | "max" | "balance";

/** Which rule an amount breaks, or null. Nothing entered breaks none (the button is simply off). */
export function amountProblem(amountMinor: number, currency: string, withdrawable: number): AmountProblem | null {
  if (amountMinor <= 0) return null;
  const { min, max } = withdrawalLimitsMinor(currency);
  if (amountMinor < min) return "min";
  if (amountMinor > max) return "max";
  if (amountMinor > withdrawable) return "balance";
  return null;
}

/** What the payout fields hold while they are being filled in: raw text, validated only by `checkPayout`. */
export type PayoutDraft =
  | { method: "BANK"; accountHolder: string; accountNumber: string; ifsc: string }
  | { method: "UPI"; upiId: string }
  | { method: "USDT"; usdtNetwork: UsdtNetwork; usdtAddress: string };

/** The network a USDT payout starts on, as on the website. */
export const DEFAULT_PAYOUT_NETWORK: UsdtNetwork = "tron";

/**
 * The fields to start `method` with: the user's last payout of that kind, else empty. The bank holder falls back to
 * the verified (KYC) name, since a payout is only paid to the person who verified.
 */
export function initialPayout(prefill: WithdrawalPrefill, method: PayoutMethod): PayoutDraft {
  const last = prefill.lastPayouts;
  switch (method) {
    case "BANK":
      return {
        method,
        accountHolder: last.BANK?.accountHolder ?? prefill.kycName,
        accountNumber: last.BANK?.accountNumber ?? "",
        ifsc: last.BANK?.ifsc ?? "",
      };
    case "UPI":
      return { method, upiId: last.UPI?.upiId ?? "" };
    case "USDT":
      return { method, usdtNetwork: last.USDT?.usdtNetwork ?? DEFAULT_PAYOUT_NETWORK, usdtAddress: last.USDT?.usdtAddress ?? "" };
  }
}

/**
 * The "Confirm account number" text: what the user typed, else the saved bank account number (as on the website, so an
 * untouched saved payout needs no retyping; editing the number above makes the two differ until it is retyped).
 */
export function accountConfirmValue(prefill: WithdrawalPrefill, typed: string | null): string {
  return typed ?? prefill.lastPayouts.BANK?.accountNumber ?? "";
}

/** True while the draft still equals the user's saved payout of its method ("Filled in from your last withdrawal"). A KYC-name-only default is not one. */
export function isFromLastWithdrawal(prefill: WithdrawalPrefill, draft: PayoutDraft): boolean {
  switch (draft.method) {
    case "BANK": {
      const saved = prefill.lastPayouts.BANK;
      return !!saved && saved.accountHolder === draft.accountHolder && saved.accountNumber === draft.accountNumber && saved.ifsc === draft.ifsc;
    }
    case "UPI":
      return prefill.lastPayouts.UPI?.upiId === draft.upiId && draft.upiId !== "";
    case "USDT": {
      const saved = prefill.lastPayouts.USDT;
      return !!saved && saved.usdtNetwork === draft.usdtNetwork && saved.usdtAddress === draft.usdtAddress;
    }
  }
}

/** The i18n key for each payout field's problem; the schema's own English text is never shown. */
const PAYOUT_ISSUE_KEYS: Record<string, string> = {
  accountHolder: "withdraw.errHolder",
  accountNumber: "withdraw.errAccount",
  ifsc: "withdraw.errIfsc",
  upiId: "withdraw.errUpi",
  usdtAddress: "withdraw.errAddress",
};

const GENERIC_PAYOUT_KEY = "withdraw.errDetails";

/** The field a schema issue is about ("" when it is about none), from its path. */
export function payoutIssueField(issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey> }>): string {
  const first = issues[0]?.path[0];
  return typeof first === "string" ? first : "";
}

/** Translation key for the first problem of a `PayoutDetailsSchema` parse, by the field it names. */
export function payoutIssueKey(issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey> }>): string {
  return PAYOUT_ISSUE_KEYS[payoutIssueField(issues)] ?? GENERIC_PAYOUT_KEY;
}

export type PayoutCheck =
  | { ok: true; payout: PayoutDetails }
  /** `field`/`key`: the first problem. `fieldKeys`: the first problem of every failing field, so each can show its own once touched. */
  | { ok: false; field: string; key: string; fieldKeys: Record<string, string> };

/** The draft through the contract's schema: the normalised payout (trimmed, IFSC upper-cased, UPI lower-cased) or its problems. */
export function checkPayout(draft: PayoutDraft): PayoutCheck {
  const parsed = PayoutDetailsSchema.safeParse(draft);
  if (parsed.success) return { ok: true, payout: parsed.data };
  const issues = parsed.error.issues;
  const fieldKeys: Record<string, string> = {};
  for (const issue of issues) {
    const field = payoutIssueField([issue]);
    if (field !== "" && !(field in fieldKeys)) fieldKeys[field] = payoutIssueKey([issue]);
  }
  return { ok: false, field: payoutIssueField(issues), key: payoutIssueKey(issues), fieldKeys };
}

export interface WithdrawModel {
  amountMinor: number;
  problem: AmountProblem | null;
  payout: PayoutCheck;
  /** What the Max button writes. */
  maxMinor: number;
  /** The balance cannot reach the minimum however it is entered. */
  belowMinimum: boolean;
  /** Bank only: the key of the "account numbers don't match" line while the confirmation differs from the number; else null. */
  accountConfirmKey: string | null;
  canSubmit: boolean;
}

/** The i18n key of the line shown when the confirmed bank account number differs from the first. */
export const ACCOUNT_MATCH_KEY = "withdraw.errAccountMatch";

/** Everything the screen draws and gates on, from the typed amount, the live balance and the payout fields. */
export function withdrawModel(input: {
  amountText: string;
  currency: string;
  withdrawable: number;
  payout: PayoutDraft;
  /** The "Confirm account number" text; a bank payout needs it equal to the account number (client-side only, as on the website). */
  accountConfirm?: string;
}): WithdrawModel {
  const amountMinor = parseAmountMinor(input.amountText, input.currency);
  const problem = amountProblem(amountMinor, input.currency, input.withdrawable);
  const payout = checkPayout(input.payout);
  const maxMinor = maxWithdrawMinor(input.withdrawable, input.currency);
  const accountConfirmKey =
    input.payout.method === "BANK" && input.payout.accountNumber.trim() !== (input.accountConfirm ?? "").trim() ? ACCOUNT_MATCH_KEY : null;
  return {
    amountMinor,
    problem,
    payout,
    maxMinor,
    belowMinimum: maxMinor < withdrawalLimitsMinor(input.currency).min,
    accountConfirmKey,
    canSubmit: amountMinor > 0 && problem === null && payout.ok && accountConfirmKey === null,
  };
}

/**
 * Where the money is going, for a second look before the Withdraw tap: a UPI ID in full; a bank payout as the holder
 * and, on a second line, "A/c ••••1234 · IFSC"; USDT as its network and a shortened address.
 */
export function payoutDestinationLabel(payout: PayoutDetails): string {
  switch (payout.method) {
    case "UPI":
      return payout.upiId;
    case "BANK":
      return `${payout.accountHolder}\nA/c \u2022\u2022\u2022\u2022${payout.accountNumber.slice(-4)} \u00b7 ${payout.ifsc}`;
    case "USDT":
      return `${USDT_NETWORK_INFO[payout.usdtNetwork].standard} ${payout.usdtAddress.slice(0, 6)}\u2026${payout.usdtAddress.slice(-6)}`;
  }
}

/** A held withdrawal as far as its cancel window is concerned. */
export interface CancelWindow {
  /** ISO deadline; null = the server says there is none (cannot be cancelled); absent = an older server that sends no such field. */
  cancelableUntil?: string | null;
}

/**
 * Whether to offer Cancel on a held withdrawal: only while its cancel deadline is ahead (the server refuses after it,
 * and a row with no deadline can never be cancelled, as on the website). An older server sends no field at all, and an
 * unreadable value is treated the same: keep offering it, as before.
 */
export function canCancelHeld(row: CancelWindow, nowMs: number): boolean {
  if (row.cancelableUntil === null) return false;
  if (row.cancelableUntil === undefined) return true;
  const until = Date.parse(row.cancelableUntil);
  return Number.isNaN(until) ? true : nowMs < until;
}

/** The soonest cancel deadline still ahead of `nowMs` (so the screen can re-check then), or null when none is. */
export function nextCancelDeadlineMs(rows: readonly CancelWindow[], nowMs: number): number | null {
  let next: number | null = null;
  for (const row of rows) {
    const until = row.cancelableUntil == null ? Number.NaN : Date.parse(row.cancelableUntil);
    if (until > nowMs && (next === null || until < next)) next = until;
  }
  return next;
}

/**
 * The `POST /api/withdrawals` body, parsed through the contract the server enforces, so a body it would refuse (a float
 * or zero amount, a bad payout, an id that is not a uuid) is never sent. Throws for such a body.
 */
export function withdrawBody(accountId: string, amountMinor: number, payout: PayoutDetails): CreateWithdrawalInput {
  return CreateWithdrawalSchema.parse({ accountId, amount: amountMinor, payout });
}
