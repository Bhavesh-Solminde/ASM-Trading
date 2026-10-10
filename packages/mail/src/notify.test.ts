import { beforeEach, describe, expect, it, vi } from "vitest";

const { sendEmail } = vi.hoisted(() => ({
  sendEmail: vi.fn(async (_msg: { to: string; subject: string; html: string; idempotencyKey?: string; tag?: string }) => ({
    ok: true as const,
    id: "em_1",
  })),
}));
vi.mock("./send", () => ({ sendEmail }));

import {
  sendDepositCreditedEmail,
  sendPasswordChangedEmail,
  sendPasswordResetEmail,
  sendWelcomeEmail,
  sendWithdrawalPaidEmail,
  sendWithdrawalRejectedEmail,
  sendWithdrawalRequestedEmail,
} from "./notify";

const last = () => sendEmail.mock.calls.at(-1)![0];
beforeEach(() => sendEmail.mockClear());

describe("notify senders", () => {
  it("keys each email so a re-run never sends it twice", async () => {
    await sendWelcomeEmail({ to: "a@gmail.com", userId: "u1", name: "Asha", firstDepositBonusPercent: 100 });
    expect(last()).toMatchObject({ to: "a@gmail.com", idempotencyKey: "welcome/u1", tag: "welcome" });

    await sendPasswordResetEmail({ to: "a@gmail.com", tokenId: "t1", name: "Asha", resetUrl: "https://indianxtrade.com/reset-password?token=x", ttlMinutes: 30 });
    expect(last()).toMatchObject({ idempotencyKey: "password-reset/t1", tag: "password_reset" });

    await sendPasswordChangedEmail({ to: "a@gmail.com", userId: "u1", name: "Asha", changedAt: new Date(1_000) });
    expect(last()).toMatchObject({ idempotencyKey: "password-changed/u1/1000", tag: "password_changed" });

    await sendDepositCreditedEmail({ to: "a@gmail.com", depositId: "d1", name: "Asha", creditLabel: "₹1.00", bonusLabel: null, totalLabel: "₹1.00" });
    expect(last()).toMatchObject({ idempotencyKey: "deposit-credited/d1", tag: "deposit_credited" });

    await sendWithdrawalRequestedEmail({ to: "a@gmail.com", withdrawalId: "w1", name: "Asha", amountLabel: "₹1.00", payToLabel: "UPI", held: false });
    expect(last()).toMatchObject({ idempotencyKey: "withdrawal-requested/w1", tag: "withdrawal_requested" });

    await sendWithdrawalPaidEmail({
      to: "a@gmail.com", withdrawalId: "w1", payToLabel: "UPI",
      certificate: { name: "Asha", amountLabel: "₹1.00", dateLabel: "11 Oct 2026", refId: "W1" },
    });
    expect(last()).toMatchObject({ idempotencyKey: "withdrawal-paid/w1", tag: "withdrawal_paid" });

    await sendWithdrawalRejectedEmail({ to: "a@gmail.com", withdrawalId: "w1", name: "Asha", amountLabel: "₹1.00", reason: "Bad UPI" });
    expect(last()).toMatchObject({ idempotencyKey: "withdrawal-rejected/w1", tag: "withdrawal_rejected" });
  });

  it("uses the deposit id's short form as the reference", async () => {
    await sendDepositCreditedEmail({ to: "a@gmail.com", depositId: "d41c09aa-0000", name: "Asha", creditLabel: "₹1.00", bonusLabel: null, totalLabel: "₹1.00" });
    expect(last().html).toContain("D41C09AA");
  });
});
