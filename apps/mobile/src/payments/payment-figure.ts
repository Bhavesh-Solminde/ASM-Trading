import { paymentMovedNoMoney, type PaymentRow } from "@asm/client-core";

export interface PaymentFigure {
  /** "+" for a credited deposit, a true minus (U+2212) for a withdrawal that moved money, else nothing. */
  sign: "+" | "−" | "";
  /** Which ink the amount takes: `up` (credited), `ink3` (no money moved) or the plain `ink`. */
  tone: "up" | "ink" | "ink3";
}

/** How a payment row's amount reads: its sign and ink. Money that never moved is muted and unsigned. */
export function paymentFigure(row: Pick<PaymentRow, "kind" | "status">): PaymentFigure {
  if (paymentMovedNoMoney(row.status)) return { sign: "", tone: "ink3" };
  if (row.kind === "deposit") return row.status === "COMPLETED" ? { sign: "+", tone: "up" } : { sign: "", tone: "ink" };
  return { sign: "−", tone: "ink" };
}
