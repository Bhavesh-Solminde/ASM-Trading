import { USDT_NETWORK_INFO, isUsdtNetwork } from "@asm/contracts";
import type { PaymentRow } from "./history-model";

/**
 * Maps database deposit / withdrawal rows to the serialisable `PaymentRow`
 * the History list and detail sheet render. Pure (no DB access) so the
 * labelling and masking rules are unit-tested; the pages do the fetching.
 */

export interface DepositSource {
  id: string;
  method: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
  network: string | null;
}

export interface WithdrawalSource {
  id: string;
  method: string;
  status: string;
  amount: number;
  currency: string;
  createdAt: Date;
  holdUntil: Date | null;
  cancelableUntil: Date | null;
  accountNumber: string | null;
  upiId: string | null;
  usdtNetwork: string | null;
  usdtAddress: string | null;
}

const last4 = (value: string) => value.replace(/\s/g, "").slice(-4);

export function depositMethodLabel(d: Pick<DepositSource, "method" | "network">): string {
  if (d.method !== "USDT") return d.method;
  return d.network && isUsdtNetwork(d.network) ? `USDT ${USDT_NETWORK_INFO[d.network].standard}` : "USDT";
}

export function withdrawalMethodLabel(w: Pick<WithdrawalSource, "method" | "usdtNetwork">): string {
  switch (w.method) {
    case "BANK":
      return "Bank transfer";
    case "UPI":
      return "UPI";
    case "USDT":
      return w.usdtNetwork && isUsdtNetwork(w.usdtNetwork) ? `USDT ${USDT_NETWORK_INFO[w.usdtNetwork].standard}` : "USDT";
    default:
      // Rows from before payout details existed carry a deposit-method label.
      return w.method;
  }
}

/** Where a withdrawal is going, with the sensitive part masked. Null for legacy rows with no details. */
export function withdrawalDestination(
  w: Pick<WithdrawalSource, "method" | "accountNumber" | "upiId" | "usdtAddress">,
): string | null {
  if (w.method === "BANK" && w.accountNumber) return `Bank •••• ${last4(w.accountNumber)}`;
  if (w.method === "UPI" && w.upiId) return w.upiId;
  if (w.method === "USDT" && w.usdtAddress) return `Wallet •••• ${last4(w.usdtAddress)}`;
  return null;
}

export function depositRow(d: DepositSource, amountMinor: number, currency: string): PaymentRow {
  return {
    key: `d:${d.id}`,
    id: d.id,
    kind: "deposit",
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
    status: d.status,
    methodLabel: depositMethodLabel(d),
    amountMinor,
    currency,
    destination: null,
    expiresAt: d.status === "AWAITING_PAYMENT" ? d.expiresAt.toISOString() : null,
    holdUntil: null,
    cancelableUntil: null,
  };
}

export function withdrawalRow(w: WithdrawalSource): PaymentRow {
  const held = w.status === "HELD";
  return {
    key: `w:${w.id}`,
    id: w.id,
    kind: "withdrawal",
    createdAt: w.createdAt.toISOString(),
    updatedAt: null,
    status: w.status,
    methodLabel: withdrawalMethodLabel(w),
    amountMinor: w.amount,
    currency: w.currency,
    destination: withdrawalDestination(w),
    expiresAt: null,
    holdUntil: held && w.holdUntil ? w.holdUntil.toISOString() : null,
    cancelableUntil: held && w.cancelableUntil ? w.cancelableUntil.toISOString() : null,
  };
}

/**
 * Short reference shown to the user, e.g. "WD-8F3K2Q1A". It keeps the first 8
 * characters of the id, the same slice the old history table showed, so a
 * reference a customer already quoted still matches.
 */
export function referenceFor(row: Pick<PaymentRow, "kind" | "id">): string {
  return `${row.kind === "deposit" ? "DP" : "WD"}-${row.id.slice(0, 8).toUpperCase()}`;
}
