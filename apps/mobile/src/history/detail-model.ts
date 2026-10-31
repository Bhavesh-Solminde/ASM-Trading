import { referenceFor, type PaymentRow } from "@asm/client-core";
import { canCancelHeld } from "@/payments/withdraw-form";
import { paymentFigure } from "@/payments/payment-figure";

export interface DetailModel {
  /** `DP-8F3K2Q1A` / `WD-8F3K2Q1A`, the reference a customer can quote to support. */
  reference: string;
  sign: "+" | "−" | "";
  tone: "up" | "ink" | "ink3";
  /** A credited deposit: when its status last changed (the server keeps no per-step times). */
  confirmedAtMs: number | null;
  /** A held withdrawal whose hold has not lifted yet. */
  holdUntilMs: number | null;
  /** Cancel is offered: a held withdrawal still inside its cancel window. */
  canCancel: boolean;
}

const ms = (iso: string | null): number | null => {
  if (iso === null) return null;
  const value = Date.parse(iso);
  return Number.isNaN(value) ? null : value;
};

/** What the payment detail sheet shows beyond the row itself, decided from the row and the clock (pure, so it is tested). */
export function detailModel(row: PaymentRow, nowMs: number): DetailModel {
  const figure = paymentFigure(row);
  const heldWithdrawal = row.kind === "withdrawal" && row.status === "HELD";
  const holdUntil = heldWithdrawal ? ms(row.holdUntil) : null;
  return {
    reference: referenceFor(row),
    sign: figure.sign,
    tone: figure.tone,
    confirmedAtMs: row.kind === "deposit" && row.status === "COMPLETED" ? ms(row.updatedAt) : null,
    holdUntilMs: holdUntil !== null && holdUntil > nowMs ? holdUntil : null,
    canCancel: heldWithdrawal && canCancelHeld(row, nowMs),
  };
}
