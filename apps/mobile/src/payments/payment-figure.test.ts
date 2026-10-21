import { describe, expect, it } from "vitest";
import { paymentFigure } from "./payment-figure";

const row = (kind: "deposit" | "withdrawal", status: string) => ({ kind, status });

describe("paymentFigure", () => {
  it("credits a completed deposit with a plus, in the up tone", () => {
    expect(paymentFigure(row("deposit", "COMPLETED"))).toEqual({ sign: "+", tone: "up" });
  });
  it("debits a withdrawal that moved money with a true minus", () => {
    for (const s of ["REQUESTED", "HELD", "APPROVED", "PAID"]) expect(paymentFigure(row("withdrawal", s)), s).toEqual({ sign: "−", tone: "ink" });
    expect(paymentFigure(row("withdrawal", "PAID")).sign).toBe("−");
  });
  it("shows no sign and a muted tone when no money moved", () => {
    for (const s of ["REJECTED", "EXPIRED", "CANCELLED_BY_USER", "AWAITING_PAYMENT"]) {
      expect(paymentFigure(row("deposit", s)), `deposit ${s}`).toEqual({ sign: "", tone: "ink3" });
      expect(paymentFigure(row("withdrawal", s)), `withdrawal ${s}`).toEqual({ sign: "", tone: "ink3" });
    }
  });
  it("shows a deposit that is still being confirmed plainly: not credited yet, so no plus", () => {
    expect(paymentFigure(row("deposit", "PENDING_CONFIRMATION"))).toEqual({ sign: "", tone: "ink" });
  });
});
