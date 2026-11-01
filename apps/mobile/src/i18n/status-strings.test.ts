import { describe, expect, it } from "vitest";
import en from "./en.json";
import hi from "./hi.json";

// Every DepositStatus, WithdrawalStatus and TradeStatus value in packages/db/prisma/schema.prisma.
const STATUSES = [
  "AWAITING_PAYMENT",
  "PENDING_CONFIRMATION",
  "COMPLETED",
  "REJECTED",
  "EXPIRED",
  "REQUESTED",
  "APPROVED",
  "PAID",
  "HELD",
  "CANCELLED_BY_USER",
  "OPEN",
  "WON",
  "LOST",
  "REFUNDED",
] as const;

describe("pay.status strings", () => {
  it("cover every deposit, withdrawal and trade status, in both languages", () => {
    expect(Object.keys(en.pay.status).sort()).toEqual([...STATUSES].sort());
    expect(Object.keys(hi.pay.status).sort()).toEqual([...STATUSES].sort());
  });
  it("title a deposit and a withdrawal in History", () => {
    expect(en.history.title.deposit).toBeTruthy();
    expect(en.history.title.withdrawal).toBeTruthy();
    expect(hi.history.title.deposit).toBeTruthy();
    expect(hi.history.title.withdrawal).toBeTruthy();
  });
});
